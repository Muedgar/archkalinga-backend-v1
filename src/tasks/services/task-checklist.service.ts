import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { EntityManager, Repository } from 'typeorm';
import { User } from 'src/users/entities';
import {
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
  ): Promise<ChecklistMutationTaskSummary> {
    const [total, completed] = await Promise.all([
      manager.count(TaskChecklistItem, { where: { taskId: task.id } }),
      manager.count(TaskChecklistItem, {
        where: { taskId: task.id, completed: true },
      }),
    ]);

    return {
      id: task.id,
      progress: task.progress,
      completed: task.completed,
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
    const resolvedStatusId = statusId ?? task.statusId;
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
  ): Promise<TaskChecklistItemDetailSerializer[]> {
    const items = await this.checklistRepo.find({
      where: { taskId },
      relations: ['status'],
      order: { orderIndex: 'ASC', id: 'ASC' },
    });
    return items.map((item) => this.serializeItem(item));
  }

  async addItem(
    task: Task,
    actorUser: User,
    dto: AddChecklistItemDto,
  ): Promise<ChecklistItemMutationResponse> {
    return this.checklistRepo.manager.transaction(async (tx) => {
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
        task: await this.buildTaskSummary(tx, task),
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
    const item = await this.getItemOrFail(task.id, itemId);
    const shouldApplyTransition =
      dto.completed !== undefined || dto.statusId !== undefined;

    if (dto.text !== undefined) item.text = dto.text.trim();
    if (dto.orderIndex !== undefined) item.orderIndex = dto.orderIndex;
    if (dto.rank !== undefined && !shouldApplyTransition) {
      item.rank = dto.rank?.trim() || null;
    }
    const nextItemCode =
      dto.itemCode !== undefined ? dto.itemCode?.trim() || null : item.itemCode;
    if (dto.checklistGroupId !== undefined)
      item.checklistGroupId = dto.checklistGroupId ?? null;

    return this.checklistRepo.manager.transaction(async (tx) => {
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
        task: await this.buildTaskSummary(tx, task),
      };
    });
  }

  async moveItem(
    task: Task,
    itemId: string,
    actorUser: User,
    dto: MoveChecklistItemDto,
  ): Promise<ChecklistItemMoveResponse> {
    return this.checklistRepo.manager.transaction(async (tx) => {
      const [item, targetStatus] = await Promise.all([
        tx.findOne(TaskChecklistItem, {
          where: { id: itemId, taskId: task.id },
          relations: ['status'],
        }),
        tx.findOne(ProjectStatus, {
          where: { id: dto.statusId, projectId: task.projectId },
        }),
      ]);
      if (!item) throw new NotFoundException(TASK_CHECKLIST_ITEM_NOT_FOUND);
      if (!targetStatus) {
        throw new BadRequestException(
          'Checklist status is invalid for this project',
        );
      }

      const transitionResult =
        await this.checklistTransitionSvc.applyChecklistTransition(tx, {
          projectId: task.projectId,
          task,
          item,
          targetStatus,
          actorUser,
          beforeItemId: dto.beforeItemId,
          afterItemId: dto.afterItemId,
          reason: dto.reason,
        });

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.CHECKLIST_UPDATED,
        {
          itemId: transitionResult.item.id,
          operation: 'checklist_item_moved',
          reason: dto.reason ?? null,
          effects: transitionResult.effects,
        },
      );

      const refreshed = await tx.findOneOrFail(TaskChecklistItem, {
        where: { id: transitionResult.item.id, taskId: task.id },
        relations: ['status'],
      });

      return {
        item: this.serializeItem(refreshed),
        task: await this.buildTaskSummary(tx, task),
        effects: transitionResult.effects,
        changedItemIds: transitionResult.changedItemIds,
        changedTaskIds: transitionResult.changedTaskIds,
      };
    });
  }

  async validateItemCompletion(
    task: Task,
    itemId: string,
  ): Promise<ChecklistItemCompletionValidationResponse> {
    const item = await this.getItemOrFail(task.id, itemId);
    await this.checklistTransitionSvc.validateChecklistCompletion(
      this.checklistRepo.manager,
      task.projectId,
      item,
    );

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
      const item = await tx.findOne(TaskChecklistItem, {
        where: { id: itemId, taskId: task.id },
      });
      if (!item) throw new NotFoundException(TASK_CHECKLIST_ITEM_NOT_FOUND);
      if (item.branchedTaskId) {
        throw new BadRequestException(TASK_CHECKLIST_ITEM_ALREADY_BRANCHED);
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
      const completedAt = status.isDone === true ? new Date() : null;

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
          reporteeUser: task.reporteeUser ?? null,
          reporteeUserId: task.reporteeUserId ?? null,
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
    const item = await this.getItemOrFail(task.id, itemId);

    return this.checklistRepo.manager.transaction(async (tx) => {
      await tx.remove(item);
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
        task: await this.buildTaskSummary(tx, task),
      };
    });
  }

  // ── Checklist groups ──────────────────────────────────────────────────────

  async listGroups(
    taskId: string,
  ): Promise<TaskChecklistGroupDetailSerializer[]> {
    const groups = await this.checklistGroupRepo.find({
      where: { taskId },
      relations: ['items', 'items.status'],
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });
    return groups.map((g) => this.serializeGroup(g));
  }

  async createGroup(
    task: Task,
    dto: CreateChecklistGroupDto,
  ): Promise<TaskChecklistGroupDetailSerializer> {
    const count = await this.checklistGroupRepo.count({
      where: { taskId: task.id },
    });
    const orderIndex = dto.orderIndex ?? count;

    const group = await this.checklistGroupRepo.save(
      this.checklistGroupRepo.create({
        task,
        taskId: task.id,
        title: dto.title.trim(),
        orderIndex,
      }),
    );

    const withItems = await this.checklistGroupRepo.findOne({
      where: { id: group.id },
      relations: ['items', 'items.status'],
    });

    return this.serializeGroup(withItems ?? group);
  }

  async updateGroup(
    taskId: string,
    groupId: string,
    dto: UpdateChecklistGroupDto,
  ): Promise<TaskChecklistGroupDetailSerializer> {
    const group = await this.getGroupOrFail(taskId, groupId);

    if (dto.title !== undefined) group.title = dto.title.trim();
    if (dto.orderIndex !== undefined) group.orderIndex = dto.orderIndex;

    await this.checklistGroupRepo.save(group);

    const refreshed = await this.checklistGroupRepo.findOne({
      where: { id: group.id },
      relations: ['items', 'items.status'],
    });

    return this.serializeGroup(refreshed ?? group);
  }

  async deleteGroup(
    taskId: string,
    groupId: string,
  ): Promise<{ id: string; success: true }> {
    const group = await this.getGroupOrFail(taskId, groupId);
    await this.checklistGroupRepo.remove(group);
    return { id: groupId, success: true };
  }
}
