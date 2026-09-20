import { DependencyType } from '../entities/task-dependency.entity';
import {
  assertOpenHierarchy,
  canonicalStatuses,
  conflict,
  lockWorkflow,
  rollupStatuses,
} from '../workflow/workflow-domain';
import { CanonicalStage } from '../project-config/project-status.entity';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { EntityManager, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { TaskDocumentsService } from './task-documents.service';
import { ScheduleCalculationService } from './schedule-calculation.service';
import { User } from 'src/users/entities';
import {
  ChecklistDependency,
  TaskDependency,
  TaskDocumentType,
  TaskDocument,
  ChecklistSubmission,
  ScheduleType,
  Task,
  TaskActionType,
  TaskAssignee,
  TaskChecklist,
  TaskChecklistBranchStatus,
  TaskChecklistItem,
} from '../entities';
import {
  AddChecklistItemDto,
  BranchChecklistItemDto,
  CreateChecklistGroupDto,
  MoveChecklistItemDto,
  UpdateChecklistGroupDto,
  UpdateChecklistItemDto,
} from '../dtos';
import {
  TASK_CHECKLIST_ITEM_ALREADY_BRANCHED,
  TASK_CHECKLIST_ITEM_CODE_ALREADY_EXISTS,
  TASK_CHECKLIST_GROUP_MISMATCH,
  TASK_CHECKLIST_GROUP_NOT_FOUND,
  TASK_CHECKLIST_ITEM_NOT_FOUND,
} from '../messages';
import { ProjectStatus, ProjectTaskType } from '../project-config';
import {
  TaskChecklistGroupDetailSerializer,
  TaskChecklistItemDetailSerializer,
} from '../serializers';
import { TaskActivityService } from './task-activity.service';
import { TaskAuthService } from './task-auth.service';
import { TaskChecklistTransitionService } from './task-checklist-transition.service';
import { TaskMembersService } from './task-members.service';
import { TaskProgressService } from './task-progress.service';
import { TaskRankingService } from './task-ranking.service';
import { TaskWbsService } from './task-wbs.service';

type ChecklistMutationTaskSummary = {
  id: string;
  statusId: string;
  revision: number;
  cascade: { calculationRunId: string; refreshTaskIds: string[] };
  progress: number | null;
  completed: boolean;
  checklistSummary: {
    total: number;
    completed: number;
  };
};

type ChecklistItemMutationResponse = {
  item: TaskChecklistItemDetailSerializer;
  task: ChecklistMutationTaskSummary;
};

type ChecklistItemDeleteResponse = {
  item: {
    id: string;
    deleted: true;
  };
  task: ChecklistMutationTaskSummary;
};

type ChecklistItemMoveResponse = {
  item: TaskChecklistItemDetailSerializer;
  task: ChecklistMutationTaskSummary;
  effects: {
    previousStatusId: string;
    nextStatusId: string;
    previousCompleted: boolean;
    nextCompleted: boolean;
  };
  changedItemIds: string[];
  changedTaskIds: string[];
};

type ChecklistItemCompletionValidationResponse = {
  allowed: true;
  itemId: string;
  branchedTaskId: string | null;
};

@Injectable()
export class TaskChecklistService {
  constructor(
    @InjectRepository(TaskChecklist)
    private readonly checklistGroupRepo: Repository<TaskChecklist>,
    @InjectRepository(TaskChecklistItem)
    private readonly checklistRepo: Repository<TaskChecklistItem>,
    private readonly activitySvc: TaskActivityService,
    private readonly authSvc: TaskAuthService,
    private readonly checklistTransitionSvc: TaskChecklistTransitionService,
    private readonly membersSvc: TaskMembersService,
    private readonly progressSvc: TaskProgressService,
    private readonly rankingSvc: TaskRankingService,
    private readonly wbsSvc: TaskWbsService,
    private readonly documentsSvc: TaskDocumentsService,
    private readonly scheduleSvc: ScheduleCalculationService,
  ) {}

  // ── Serializers ───────────────────────────────────────────────────────────

  private serializeItem(
    item: Partial<TaskChecklistItem>,
  ): TaskChecklistItemDetailSerializer {
    return plainToInstance(TaskChecklistItemDetailSerializer, item, {
      excludeExtraneousValues: true,
    });
  }

  private serializeGroup(
    group: Partial<TaskChecklist>,
  ): TaskChecklistGroupDetailSerializer {
    return plainToInstance(TaskChecklistGroupDetailSerializer, group, {
      excludeExtraneousValues: true,
    });
  }

  private async buildTaskSummary(
    manager: EntityManager,
    task: Task,
    actor: RequestUser,
  ): Promise<ChecklistMutationTaskSummary> {
    const progress = await this.progressSvc.recalculateProjectTaskProgress(
      manager,
      task.projectId,
    );
    task.progress = progress.get(task.id) ?? task.progress;
    const schedule = await this.scheduleSvc.recalculateProject(
      task.projectId,
      { triggerTaskId: task.id, triggerType: 'checklist-change' },
      manager,
    );
    const [total, completed] = await Promise.all([
      manager.count(TaskChecklistItem, { where: { taskId: task.id } }),
      manager.count(TaskChecklistItem, {
        where: { taskId: task.id, completed: true },
      }),
    ]);

    const refreshTaskIds: string[] = [];
    for (const candidate of await manager.find(Task, {
      where: { projectId: task.projectId },
      relations: ['assignees'],
    })) {
      if (
        !candidate.deletedAt &&
        (await this.authSvc.canViewTask(candidate, actor))
      )
        refreshTaskIds.push(candidate.id);
    }
    const current = await manager.findOneByOrFail(Task, { id: task.id });
    return {
      id: task.id,
      statusId: current.statusId,
      revision: current.version,
      cascade: { calculationRunId: schedule.calculationRunId, refreshTaskIds },
      progress: current.progress,
      completed: current.completed,
      checklistSummary: { total, completed },
    };
  }

  // ── Private loaders ───────────────────────────────────────────────────────

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async getItemOrFail(
    taskId: string,
    itemId: string,
  ): Promise<TaskChecklistItem> {
    if (!TaskChecklistService.UUID_REGEX.test(itemId)) {
      throw new BadRequestException(
        `Invalid checklist item ID "${itemId}". Use the UUID returned by the server when the item was created.`,
      );
    }
    const item = await this.checklistRepo.findOne({
      where: { id: itemId, taskId },
      relations: ['status'],
    });
    if (!item) throw new NotFoundException(TASK_CHECKLIST_ITEM_NOT_FOUND);
    return item;
  }

  async getGroupOrFail(
    taskId: string,
    groupId: string,
  ): Promise<TaskChecklist> {
    const group = await this.checklistGroupRepo.findOne({
      where: { id: groupId },
      relations: ['items'],
    });
    if (!group) throw new NotFoundException(TASK_CHECKLIST_GROUP_NOT_FOUND);
    if (group.taskId !== taskId)
      throw new NotFoundException(TASK_CHECKLIST_GROUP_MISMATCH);
    return group;
  }

  private async ensureUniqueItemCode(
    manager: EntityManager,
    taskId: string,
    itemCode: string | null,
    excludeItemId?: string,
  ): Promise<void> {
    if (!itemCode) return;
    const duplicate = await manager.findOne(TaskChecklistItem, {
      where: { taskId, itemCode },
    });
    if (duplicate && duplicate.id !== excludeItemId) {
      throw new BadRequestException(TASK_CHECKLIST_ITEM_CODE_ALREADY_EXISTS);
    }
  }

  private async resolveChecklistStatusId(
    manager: EntityManager,
    task: Pick<Task, 'projectId' | 'statusId'>,
    statusId?: string | null,
  ): Promise<string> {
    const canonical = await canonicalStatuses(manager, task.projectId);
    const resolvedStatusId = statusId ?? canonical.get(CanonicalStage.TODO)!.id;
    if (resolvedStatusId !== canonical.get(CanonicalStage.TODO)!.id)
      conflict('CHECKLIST_INITIAL_STATUS_MUST_BE_TODO');
    const status = await manager.findOne(ProjectStatus, {
      where: { id: resolvedStatusId, projectId: task.projectId },
      select: ['id'],
    });
    if (!status) {
      throw new BadRequestException(
        'Checklist status is invalid for this project',
      );
    }
    return status.id;
  }

  private async resolveChecklistTransitionTargetStatus(
    manager: EntityManager,
    task: Pick<Task, 'projectId' | 'statusId'>,
    item: TaskChecklistItem,
    dto: Pick<UpdateChecklistItemDto, 'completed' | 'statusId'>,
  ): Promise<ProjectStatus> {
    let targetStatus: ProjectStatus | null = null;

    if (dto.statusId !== undefined) {
      targetStatus = await manager.findOne(ProjectStatus, {
        where: { id: dto.statusId, projectId: task.projectId },
      });
      if (!targetStatus) {
        throw new BadRequestException(
          'Checklist status is invalid for this project',
        );
      }
    } else if (dto.completed === true) {
      targetStatus =
        item.status?.isDone === true
          ? item.status
          : await this.loadSingleActiveDoneStatus(manager, task.projectId);
      if (!targetStatus) {
        throw new BadRequestException(
          'Project must have exactly one active Done status or provide statusId.',
        );
      }
    } else {
      targetStatus =
        item.status?.isDone !== true && item.status
          ? item.status
          : await this.loadDefaultNonDoneStatus(manager, task);
      if (!targetStatus) {
        throw new BadRequestException(
          'Project must have an active non-Done status or provide statusId.',
        );
      }
    }

    if (dto.completed === true && targetStatus.isDone !== true) {
      throw new BadRequestException(
        'Cannot mark checklist item complete with a non-Done status',
      );
    }
    if (dto.completed === false && targetStatus.isDone === true) {
      throw new BadRequestException(
        'Cannot mark checklist item incomplete with a Done status',
      );
    }

    return targetStatus;
  }

  private async loadSingleActiveDoneStatus(
    manager: EntityManager,
    projectId: string,
  ): Promise<ProjectStatus | null> {
    const statuses = await manager.find(ProjectStatus, {
      where: { projectId, isDone: true, isActive: true },
      take: 2,
    });
    return statuses.length === 1 ? statuses[0] : null;
  }

  private async loadDefaultNonDoneStatus(
    manager: EntityManager,
    task: Pick<Task, 'projectId' | 'statusId'>,
  ): Promise<ProjectStatus | null> {
    const taskStatus = await manager.findOne(ProjectStatus, {
      where: { id: task.statusId, projectId: task.projectId, isActive: true },
    });
    if (taskStatus && taskStatus.isDone !== true) return taskStatus;

    return manager.findOne(ProjectStatus, {
      where: {
        projectId: task.projectId,
        isDefault: true,
        isActive: true,
        isDone: false,
      },
    });
  }

  // ── Reorder helper ────────────────────────────────────────────────────────

  async reorderItems(
    manager: EntityManager,
    taskId: string,
    movingItemId: string | null,
    requestedOrderIndex?: number,
  ): Promise<void> {
    const items = await manager.find(TaskChecklistItem, {
      where: { taskId },
      order: { orderIndex: 'ASC', id: 'ASC' },
    });

    const movingItem = movingItemId
      ? (items.find((item) => item.id === movingItemId) ?? null)
      : null;
    const remaining = movingItem
      ? items.filter((item) => item.id !== movingItemId)
      : [...items];

    const targetIndex =
      requestedOrderIndex === undefined
        ? remaining.length
        : this.rankingSvc.normalizeChecklistOrder(
            requestedOrderIndex,
            remaining.length,
          );

    if (movingItem) {
      remaining.splice(targetIndex, 0, movingItem);
    }

    // Collect all items that need updating, then batch-save in one round-trip
    const toUpdate: TaskChecklistItem[] = [];
    for (const [index, item] of remaining.entries()) {
      if (item.orderIndex !== index) {
        item.orderIndex = index;
        toUpdate.push(item);
      }
    }
    if (toUpdate.length > 0) {
      await manager.save(toUpdate);
    }
  }

  // ── Checklist items ───────────────────────────────────────────────────────

  async listItems(
    taskId: string,
    requestUser?: RequestUser,
  ): Promise<TaskChecklistItemDetailSerializer[]> {
    const items = await this.checklistRepo.find({
      where: { taskId },
      relations: ['status'],
      order: { orderIndex: 'ASC', id: 'ASC' },
    });
    if (requestUser) {
      const task = await this.checklistRepo.manager.findOneOrFail(Task, {
        where: { id: taskId },
      });
      await this.authSvc.decorateChecklistRead(task, items, requestUser);
    }
    return items.map((item) => this.serializeItem(item));
  }

  async getItemDetail(task: Task, itemId: string, requestUser: RequestUser) {
    const item = await this.getItemOrFail(task.id, itemId);
    await this.authSvc.decorateChecklistRead(task, [item], requestUser);
    const documents = await this.documentsSvc.listTaskDocuments(task.id, {
      checklistItemId: item.id,
      limit: 200,
      page: 1,
    });
    const dependencies = await this.checklistRepo.manager.find(
      ChecklistDependency,
      { where: { checklistItemId: item.id } },
    );
    const inheritedStarterDocuments = await this.documentsSvc.listTaskDocuments(
      task.id,
      { type: TaskDocumentType.STARTER, scope: 'TASK', limit: 200, page: 1 },
    );
    const legacyOwner = item.branchedTaskId
      ? await this.checklistRepo.manager.findOne(Task, {
          where: { id: item.branchedTaskId },
          relations: ['assignees'],
        })
      : null;
    const canReadLegacy =
      legacyOwner && (await this.authSvc.canViewTask(legacyOwner, requestUser));
    const legacyTask =
      item.legacyBranch && item.branchedTaskId && canReadLegacy
        ? {
            taskId: item.branchedTaskId,
            documents: await this.documentsSvc.listTaskDocuments(
              item.branchedTaskId,
              { limit: 200, page: 1 },
            ),
            dependencies: await this.checklistRepo.manager.find(
              TaskDependency,
              {
                where: [
                  { taskId: item.branchedTaskId },
                  { dependsOnTaskId: item.branchedTaskId },
                ],
              },
            ),
          }
        : null;
    return {
      ...this.serializeItem(item),
      assignedMembers: item.assignedMembers,
      reporteeUserId: item.reporteeUserId,
      documents,
      inheritedStarterDocuments,
      warnings: [
        ...((item.earliestStartDate ?? item.plannedStartDate ?? '') >
        new Date().toISOString().slice(0, 10)
          ? [{ code: 'BEFORE_PLANNED_START' }]
          : []),
        ...(
          await Promise.all(
            dependencies.map(async (d) => {
              const predecessor = await this.checklistRepo.findOne({
                where: { id: d.dependsOnChecklistItemId },
              });
              return predecessor && !predecessor.completed
                ? { code: 'PREDECESSOR_INCOMPLETE' }
                : null;
            }),
          )
        ).filter(Boolean),
      ],
      dependencies,
      legacyTask,
    };
  }

  async addItem(
    task: Task,
    actorUser: User,
    dto: AddChecklistItemDto,
  ): Promise<ChecklistItemMutationResponse> {
    return this.checklistRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, task.projectId);
      await this.authSvc.assertTaskOwnedChecklistManagementAllowed({
        projectId: task.projectId,
        taskId: task.id,
        requestUser: actorUser,
      });
      await assertOpenHierarchy(tx, task.projectId, task.id);
      const itemCode = dto.itemCode?.trim() || null;
      await this.ensureUniqueItemCode(tx, task.id, itemCode);
      const statusId = await this.resolveChecklistStatusId(
        tx,
        task,
        dto.statusId,
      );

      const item = await tx.save(
        tx.create(TaskChecklistItem, {
          task,
          taskId: task.id,
          text: dto.text.trim(),
          orderIndex: 0,
          statusId,
          rank: dto.rank?.trim() || null,
          itemCode,
          completed: false,
          completedByUserId: null,
          completedAt: null,
          checklistGroupId: dto.checklistGroupId ?? null,
        }),
      );

      await this.reorderItems(tx, task.id, item.id, dto.orderIndex ?? 0);
      const saved = await tx.findOneOrFail(TaskChecklistItem, {
        where: { id: item.id, taskId: task.id },
        relations: ['status'],
      });

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.CHECKLIST_UPDATED,
        {
          itemId: saved.id,
          operation: 'checklist_item_added',
        },
      );

      return {
        item: this.serializeItem(saved),
        task: await this.buildTaskSummary(tx, task, actorUser),
      };
    });
  }

  async updateItem(
    task: Task,
    itemId: string,
    requestUserId: string,
    actorUser: User,
    dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemMutationResponse> {
    if (dto.statusId !== undefined || dto.completed !== undefined)
      conflict('WORKFLOW_COMMAND_REQUIRED');
    return this.checklistRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, task.projectId);
      await this.authSvc.assertTaskOwnedChecklistManagementAllowed({
        projectId: task.projectId,
        taskId: task.id,
        requestUser: actorUser,
      });
      const item = await tx.findOne(TaskChecklistItem, {
        where: { id: itemId, taskId: task.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException(TASK_CHECKLIST_ITEM_NOT_FOUND);
      if (
        dto.expectedRevision !== undefined &&
        dto.expectedRevision !== item.version
      )
        conflict('STALE_WORKFLOW_REVISION');
      if (dto.description !== undefined) item.description = dto.description;
      if (dto.durationDays !== undefined) item.durationDays = dto.durationDays;
      if (dto.earliestStartDate !== undefined)
        item.earliestStartDate = dto.earliestStartDate;
      if (dto.dependencies) {
        const targets = dto.dependencies.map((d) => d.dependsOnChecklistItemId);
        if (
          new Set(targets).size !== targets.length ||
          targets.includes(item.id)
        )
          throw new BadRequestException('INVALID_CHECKLIST_DEPENDENCY');
        for (const targetId of targets) {
          const target = await tx.findOne(TaskChecklistItem, {
            where: { id: targetId },
            relations: ['task', 'task.assignees'],
          });
          if (
            !target ||
            target.task.projectId !== task.projectId ||
            !(await this.authSvc.canViewTask(target.task, actorUser))
          )
            throw new BadRequestException('INVALID_CHECKLIST_DEPENDENCY');
        }
        const edges = await tx
          .createQueryBuilder(ChecklistDependency, 'd')
          .innerJoin(TaskChecklistItem, 'i', 'i.id = d.checklistItemId')
          .innerJoin(Task, 't', 't.id = i.taskId')
          .where('t.projectId = :projectId', { projectId: task.projectId })
          .getMany();
        const reaches = (id: string, seen = new Set<string>()): boolean => {
          if (id === item.id) return true;
          if (seen.has(id)) return false;
          seen.add(id);
          return edges
            .filter((e) => e.checklistItemId === id)
            .some((e) => reaches(e.dependsOnChecklistItemId, seen));
        };
        if (targets.some((id) => reaches(id)))
          throw new BadRequestException('CHECKLIST_DEPENDENCY_CYCLE');
        await tx.delete(ChecklistDependency, { checklistItemId: item.id });
        for (const d of dto.dependencies)
          await tx.save(
            ChecklistDependency,
            tx.create(ChecklistDependency, {
              ...d,
              checklistItemId: item.id,
              dependencyType:
                d.dependencyType ?? DependencyType.FINISH_TO_START,
              lagDays: d.lagDays ?? 0,
            }),
          );
      }
      const shouldApplyTransition =
        dto.completed !== undefined || dto.statusId !== undefined;

      if (dto.text !== undefined) item.text = dto.text.trim();
      if (dto.orderIndex !== undefined) item.orderIndex = dto.orderIndex;
      if (dto.rank !== undefined && !shouldApplyTransition) {
        item.rank = dto.rank?.trim() || null;
      }
      const nextItemCode =
        dto.itemCode !== undefined
          ? dto.itemCode?.trim() || null
          : item.itemCode;
      if (dto.checklistGroupId !== undefined)
        item.checklistGroupId = dto.checklistGroupId ?? null;

      if (dto.itemCode !== undefined) {
        await this.ensureUniqueItemCode(tx, task.id, nextItemCode, item.id);
        item.itemCode = nextItemCode;
      }
      let saved: TaskChecklistItem;
      if (shouldApplyTransition) {
        const targetStatus = await this.resolveChecklistTransitionTargetStatus(
          tx,
          task,
          item,
          dto,
        );
        const transitionResult =
          await this.checklistTransitionSvc.applyChecklistTransition(tx, {
            projectId: task.projectId,
            task,
            item,
            targetStatus,
            actorUser,
          });
        saved = transitionResult.item;
      } else {
        saved = await tx.save(item);
      }
      if (dto.orderIndex !== undefined) {
        await this.reorderItems(tx, task.id, saved.id, dto.orderIndex);
      }
      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.CHECKLIST_UPDATED,
        {
          itemId: saved.id,
          operation: 'checklist_item_updated',
        },
      );
      const refreshed = await tx.findOneOrFail(TaskChecklistItem, {
        where: { id: saved.id, taskId: task.id },
        relations: ['status'],
      });
      return {
        item: this.serializeItem(refreshed),
        task: await this.buildTaskSummary(tx, task, actorUser),
      };
    });
  }

  async moveItem(
    _task: Task,
    _itemId: string,
    _actorUser: User,
    _dto: MoveChecklistItemDto,
  ): Promise<ChecklistItemMoveResponse> {
    conflict('WORKFLOW_COMMAND_REQUIRED');
  }

  async validateItemCompletion(
    task: Task,
    itemId: string,
    actor: RequestUser,
  ): Promise<ChecklistItemCompletionValidationResponse> {
    const item = await this.getItemOrFail(task.id, itemId);
    await this.authSvc.decorateChecklistRead(task, [item], actor);
    if (!item.capabilities?.canReview || !item.activeSubmission)
      conflict('CHECKLIST_REVIEW_REQUIRED');
    return {
      allowed: true,
      itemId: item.id,
      branchedTaskId: item.branchedTaskId ?? null,
    };
  }

  async branchItem(
    task: Task,
    itemId: string,
    actorUser: User,
    dto: BranchChecklistItemDto,
  ): Promise<TaskChecklistItemDetailSerializer> {
    this.authSvc.ensureDateRange(dto.startDate, dto.endDate);

    return this.checklistRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, task.projectId);
      await this.authSvc.assertTaskChecklistBranchAllowed({
        projectId: task.projectId,
        taskId: task.id,
        requestUser: actorUser,
      });
      await assertOpenHierarchy(tx, task.projectId, task.id);
      const item = await tx.findOne(TaskChecklistItem, {
        where: { id: itemId, taskId: task.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException(TASK_CHECKLIST_ITEM_NOT_FOUND);
      if (item.effectiveStage === 'IN_REVIEW')
        conflict('WITHDRAW_BEFORE_BRANCHING');
      if (item.completed || task.completed)
        throw new ConflictException(
          'Completed work must be reopened before branching',
        );
      if (item.branchedTaskId) {
        throw new ConflictException(TASK_CHECKLIST_ITEM_ALREADY_BRANCHED);
      }

      const itemCode = dto.itemCode?.trim() || item.itemCode || null;
      await this.ensureUniqueItemCode(tx, task.id, itemCode, item.id);

      const [status, taskType] = await Promise.all([
        dto.statusId
          ? tx.findOne(ProjectStatus, {
              where: { id: dto.statusId, projectId: task.projectId },
            })
          : tx.findOne(ProjectStatus, {
              where: { projectId: task.projectId, isDefault: true },
            }),
        dto.taskTypeId
          ? tx.findOne(ProjectTaskType, {
              where: { id: dto.taskTypeId, projectId: task.projectId },
            })
          : tx.findOne(ProjectTaskType, {
              where: { projectId: task.projectId, isDefault: true },
            }),
      ]);

      if (!status) {
        throw new BadRequestException(
          'Project has no default status. Provide statusId.',
        );
      }
      if (!taskType) {
        throw new BadRequestException(
          'Project has no default task type. Provide taskTypeId.',
        );
      }
      if (task.completed && status.isDone !== true) {
        throw new BadRequestException(
          'Cannot add an incomplete subtask to a completed parent task',
        );
      }

      await this.authSvc.assertWipLimit(tx, status.id, task.projectId);

      const assignedUsers =
        dto.assignedMembers !== undefined
          ? await this.membersSvc.ensureAssignedMembers(
              task.projectId,
              dto.assignedMembers,
              tx,
              actorUser,
            )
          : [];

      const rank = await this.rankingSvc.getNextRank(
        tx,
        task.projectId,
        task.id,
        status.id,
      );
      const initialWbs = this.wbsSvc.prepareAssignment(dto.wbsCode);
      if (
        status.id !==
        (await canonicalStatuses(tx, task.projectId)).get(CanonicalStage.TODO)!
          .id
      )
        conflict('TASK_INITIAL_STATUS_MUST_BE_TODO');
      const completedAt = null;

      const childTask = await tx.save(
        tx.create(Task, {
          project: task.project,
          projectId: task.projectId,
          parent: task,
          parentTaskId: task.id,
          statusId: status.id,
          priorityId: task.priorityId ?? null,
          taskTypeId: taskType.id,
          severityId: task.severityId ?? null,
          createdByUser: actorUser,
          createdByUserId: actorUser.id,
          reporteeUser: actorUser,
          reporteeUserId: actorUser.id,
          title: dto.title?.trim() || item.text.trim(),
          description: null,
          startDate: dto.startDate ?? null,
          endDate: dto.endDate ?? null,
          progress: status.isDone === true ? 100 : (dto.progress ?? 0),
          completed: status.isDone === true,
          completedAt,
          completedByUser: status.isDone === true ? actorUser : null,
          completedByUserId: status.isDone === true ? actorUser.id : null,
          scheduleType: ScheduleType.TASK,
          wbsCode: initialWbs.wbsCode,
          wbsSortKey: initialWbs.wbsSortKey,
          weightPercent: dto.weightPercent ?? null,
          isManuallyScheduled: false,
          manualScheduleReason: null,
          rank,
          deletedAt: null,
        }),
      );
      await this.wbsSvc.reserveExistingTaskCode(tx, childTask, actorUser.id);

      if (assignedUsers.length) {
        await tx.save(
          assignedUsers.map(({ user, projectRoleId }) =>
            tx.create(TaskAssignee, {
              task: childTask,
              taskId: childTask.id,
              user,
              userId: user.id,
              projectRoleId,
            }),
          ),
        );
      }

      item.itemCode = itemCode;
      item.branchedTask = childTask;
      item.branchedTaskId = childTask.id;
      item.branchStatus = TaskChecklistBranchStatus.BRANCHED;
      item.branchedByUser = actorUser;
      item.branchedByUserId = actorUser.id;
      item.branchedAt = new Date();
      const savedItem = await tx.save(TaskChecklistItem, item);

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.CHECKLIST_UPDATED,
        {
          itemId: savedItem.id,
          branchedTaskId: childTask.id,
          operation: 'checklist_item_branched',
        },
      );
      await this.activitySvc.log(
        tx,
        childTask,
        actorUser,
        TaskActionType.TASK_CREATED,
        {
          title: childTask.title,
          parentTaskId: task.id,
          sourceChecklistItemId: savedItem.id,
        },
      );
      await this.progressSvc.recalculateProjectTaskProgress(tx, task.projectId);
      const refreshedItem = await tx.findOneOrFail(TaskChecklistItem, {
        where: { id: savedItem.id, taskId: task.id },
        relations: ['status'],
      });

      return this.serializeItem(refreshedItem);
    });
  }

  async deleteItem(
    task: Task,
    itemId: string,
    actorUser: User,
  ): Promise<ChecklistItemDeleteResponse> {
    return this.checklistRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, task.projectId);
      await this.authSvc.assertTaskOwnedChecklistManagementAllowed({
        projectId: task.projectId,
        taskId: task.id,
        requestUser: actorUser,
      });
      await assertOpenHierarchy(tx, task.projectId, task.id);
      const item = await tx.findOne(TaskChecklistItem, {
        where: { id: itemId, taskId: task.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException(TASK_CHECKLIST_ITEM_NOT_FOUND);
      if (item.branchedTaskId)
        throw new ConflictException(
          'A linked checklist cannot be deleted without handling its branched task',
        );
      if (item.completed) conflict('CHECKLIST_DONE_IS_TERMINAL');
      if (
        (await tx.exists(ChecklistSubmission, {
          where: { checklistItemId: item.id },
        })) ||
        (await tx.exists(TaskDocument, { where: { checklistItemId: item.id } }))
      )
        conflict('CHECKLIST_HAS_RETAINED_HISTORY');
      await tx.remove(item);
      await rollupStatuses(tx, task.projectId);
      await this.reorderItems(tx, task.id, null);
      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.CHECKLIST_UPDATED,
        {
          itemId,
          operation: 'checklist_item_deleted',
        },
      );

      return {
        item: { id: itemId, deleted: true },
        task: await this.buildTaskSummary(tx, task, actorUser),
      };
    });
  }

  // ── Checklist groups ──────────────────────────────────────────────────────

  async listGroups(
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskChecklistGroupDetailSerializer[]> {
    const groups = await this.checklistGroupRepo.find({
      where: { taskId },
      relations: ['items', 'items.status'],
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });
    const task = await this.checklistGroupRepo.manager.findOneByOrFail(Task, {
      id: taskId,
    });
    await this.authSvc.decorateChecklistRead(
      task,
      groups.flatMap((g) => g.items),
      requestUser,
    );
    return groups.map((g) => this.serializeGroup(g));
  }

  async createGroup(
    task: Task,
    dto: CreateChecklistGroupDto,
    actor: RequestUser,
  ): Promise<TaskChecklistGroupDetailSerializer> {
    return this.checklistGroupRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, task.projectId);
      await this.authSvc.assertTaskOwnedChecklistManagementAllowed({
        projectId: task.projectId,
        taskId: task.id,
        requestUser: actor,
      });
      await assertOpenHierarchy(tx, task.projectId, task.id);
      const count = await tx.count(TaskChecklist, {
        where: { taskId: task.id },
      });
      const group = await tx.save(
        TaskChecklist,
        tx.create(TaskChecklist, {
          task,
          taskId: task.id,
          title: dto.title.trim(),
          orderIndex: dto.orderIndex ?? count,
        }),
      );
      return this.serializeGroup({ ...group, items: [] });
    });
  }

  async updateGroup(
    taskId: string,
    groupId: string,
    dto: UpdateChecklistGroupDto,
    actor: RequestUser,
  ): Promise<TaskChecklistGroupDetailSerializer> {
    return this.checklistGroupRepo.manager.transaction(async (tx) => {
      const task = await tx.findOneByOrFail(Task, { id: taskId });
      await lockWorkflow(tx, task.projectId);
      await this.authSvc.assertTaskOwnedChecklistManagementAllowed({
        projectId: task.projectId,
        taskId,
        requestUser: actor,
      });
      await assertOpenHierarchy(tx, task.projectId, taskId);
      const group = await tx.findOneOrFail(TaskChecklist, {
        where: { id: groupId, taskId },
        relations: ['items', 'items.status'],
      });
      if (dto.title !== undefined) group.title = dto.title.trim();
      if (dto.orderIndex !== undefined) group.orderIndex = dto.orderIndex;
      await tx.save(group);
      await this.authSvc.decorateChecklistRead(task, group.items, actor);
      return this.serializeGroup(group);
    });
  }

  async deleteGroup(
    taskId: string,
    groupId: string,
    actor: RequestUser,
  ): Promise<{ id: string; success: true }> {
    return this.checklistGroupRepo.manager.transaction(async (tx) => {
      const task = await tx.findOneByOrFail(Task, { id: taskId });
      await lockWorkflow(tx, task.projectId);
      await this.authSvc.assertTaskOwnedChecklistManagementAllowed({
        projectId: task.projectId,
        taskId,
        requestUser: actor,
      });
      await assertOpenHierarchy(tx, task.projectId, taskId);
      const group = await tx.findOneOrFail(TaskChecklist, {
        where: { id: groupId, taskId },
      });
      if (
        await tx.exists(TaskChecklistItem, {
          where: { checklistGroupId: groupId },
        })
      )
        conflict('CHECKLIST_GROUP_NOT_EMPTY');
      await tx.remove(group);
      return { id: groupId, success: true };
    });
  }
}
