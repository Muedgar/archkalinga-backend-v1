import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { ProjectMembership } from 'src/projects/entities';
import { User } from 'src/users/entities';
import {
  BulkUpdateTasksDto,
  CompleteTaskDto,
  CreateTaskDto,
  MoveTaskDto,
  ReopenTaskDto,
  SupersedeTaskDto,
  UpdateTaskProgressDto,
  UpdateTaskDto,
} from '../dtos';
import {
  DependencyType,
  Task,
  TaskActionType,
  TaskActivitySchedule,
  TaskChecklistBranchStatus,
  TaskAssignee,
  TaskChecklistItem,
  TaskDependency,
  TaskLabel,
  ScheduleType,
} from '../entities';
import {
  ProjectLabel,
  ProjectStatus,
  ProjectTaskType,
} from '../project-config';
import {
  INVALID_TASK_SUPERSESSION,
  INVALID_DONE_STATUS,
  INVALID_REOPEN_STATUS,
  TASK_ALREADY_SUPERSEDED,
  TASK_NOT_FOUND,
  TASK_REPLACEMENT_ALREADY_USED,
} from '../messages';
import { TaskListItemSerializer, TaskSerializer } from '../serializers';
import { TaskActivityService } from './task-activity.service';
import { TaskAuthService } from './task-auth.service';
import { TaskCompletionTransitionService } from './task-completion-transition.service';
import { TaskMembersService } from './task-members.service';
import { TaskRankingService } from './task-ranking.service';
import { TaskRelationsService } from './task-relations.service';
import { ScheduleCalculationService } from './schedule-calculation.service';
import { TaskProgressService } from './task-progress.service';
import { TaskWbsService } from './task-wbs.service';
import { TaskCompletionMode } from '../types/task-completion-mode.type';

type NormalizedTaskDependencyInput = {
  dependsOnTaskId: string;
  dependencyType: DependencyType;
  lagDays: number;
};

type CompleteTaskResponse = {
  task: TaskSerializer;
  effects: {
    checklistItemsCompleted: number;
    descendantTasksCompleted: number;
    rollupsRecalculated: boolean;
  };
  changedTaskIds: string[];
  warnings: string[];
};

type ValidateTaskCompletionResponse = {
  allowed: true;
  taskId: string;
  statusId: string;
  effects: {
    checklistItemsCompleted: number;
    descendantTasksCompleted: number;
    rollupsRecalculated: boolean;
  };
  changedTaskIds: [];
  warnings: string[];
};

type ReopenTaskResponse = {
  task: TaskSerializer;
  audit: {
    previousStatusId: string;
    nextStatusId: string;
    previousProgress: number | null;
    nextProgress: number | null;
    reason: string | null;
  };
};

type BulkTaskUpdateFailure = {
  taskId: string;
  code: string;
  message: string;
  details?: unknown;
};

type BulkTaskUpdateResponse = {
  tasks: TaskListItemSerializer[];
  succeeded: string[];
  failed: BulkTaskUpdateFailure[];
  changedTaskIds: string[];
};

@Injectable()
export class TaskCrudService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskAssignee)
    private readonly taskAssigneeRepo: Repository<TaskAssignee>,
    @InjectRepository(TaskChecklistItem)
    private readonly checklistRepo: Repository<TaskChecklistItem>,
    @InjectRepository(TaskDependency)
    private readonly dependencyRepo: Repository<TaskDependency>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ProjectStatus)
    private readonly projectStatusRepo: Repository<ProjectStatus>,
    @InjectRepository(ProjectTaskType)
    private readonly projectTaskTypeRepo: Repository<ProjectTaskType>,
    @InjectRepository(TaskLabel)
    private readonly taskLabelRepo: Repository<TaskLabel>,
    @InjectRepository(ProjectLabel)
    private readonly projectLabelRepo: Repository<ProjectLabel>,
    @InjectRepository(TaskActivitySchedule)
    private readonly activityScheduleRepo: Repository<TaskActivitySchedule>,
    private readonly authSvc: TaskAuthService,
    private readonly rankingSvc: TaskRankingService,
    private readonly activitySvc: TaskActivityService,
    private readonly membersSvc: TaskMembersService,
    private readonly relationsSvc: TaskRelationsService,
    private readonly scheduleCalculationSvc: ScheduleCalculationService,
    private readonly progressSvc: TaskProgressService,
    private readonly wbsSvc: TaskWbsService,
    private readonly transitionSvc: TaskCompletionTransitionService,
  ) {}

  async createTask(
    projectId: string,
    dto: CreateTaskDto,
    requestUser: RequestUser,
    getTask: (
      projectId: string,
      taskId: string,
      requestUser: RequestUser,
      membership?: ProjectMembership | null,
    ) => Promise<TaskSerializer>,
  ): Promise<TaskSerializer> {
    const { project, membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'create',
    );
    // Initial checklist, schedule, assignee, and reportee values are allowed as
    // part of creation because the actor becomes the task creator immediately.
    const dependencyInputs = this.normalizeDependencyInputs(dto) ?? [];

    const [parent, dependencyTasks, actorUser] = await Promise.all([
      this.authSvc.ensureParentTask(projectId, dto.parentTaskId),
      this.relationsSvc.ensureDependencyTasks(
        projectId,
        dependencyInputs.map((dependency) => dependency.dependsOnTaskId),
      ),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);
    const dependencyTaskById = new Map(
      dependencyTasks.map((task) => [task.id, task]),
    );

    this.authSvc.ensureDateRange(dto.startDate, dto.endDate);
    this.ensureScheduleDto(dto);

    const [defaultStatus, defaultTaskType] = await Promise.all([
      dto.statusId
        ? this.projectStatusRepo.findOne({
            where: { id: dto.statusId, projectId },
          })
        : this.projectStatusRepo.findOne({
            where: { projectId, isDefault: true },
          }),
      dto.taskTypeId
        ? this.projectTaskTypeRepo.findOne({
            where: { id: dto.taskTypeId, projectId },
          })
        : this.projectTaskTypeRepo.findOne({
            where: { projectId, isDefault: true },
          }),
    ]);

    if (!defaultStatus)
      throw new BadRequestException(
        'Project has no default status. Provide statusId.',
      );
    if (!defaultTaskType)
      throw new BadRequestException(
        'Project has no default task type. Provide taskTypeId.',
      );
    this.assertCompletedParentCanReceiveChild(parent, defaultStatus);

    const savedTask = await this.taskRepo.manager.transaction(async (tx) => {
      await this.authSvc.assertWipLimit(tx, defaultStatus.id, projectId);

      const assignedUsers =
        dto.assignedMembers !== undefined
          ? await this.membersSvc.ensureAssignedMembers(
              projectId,
              dto.assignedMembers,
              tx,
              actorUser,
            )
          : [];

      const rank = await this.rankingSvc.getNextRank(
        tx,
        projectId,
        parent?.id ?? null,
        defaultStatus.id,
      );

      const initialWbs = this.wbsSvc.prepareAssignment(
        dto.wbsCode,
        dto.wbsSortKey,
      );

      const task = tx.create(Task, {
        project,
        projectId,
        parent: parent ?? null,
        parentTaskId: parent?.id ?? null,
        statusId: defaultStatus.id,
        priorityId: dto.priorityId ?? null,
        taskTypeId: defaultTaskType.id,
        severityId: dto.severityId ?? null,
        createdByUser: actorUser,
        createdByUserId: actorUser.id,
        reporteeUser: actorUser,
        reporteeUserId: actorUser.id,
        title: dto.title.trim(),
        description: dto.description ?? null,
        startDate: dto.startDate ?? null,
        endDate: dto.endDate ?? null,
        progress: dto.progress ?? 0,
        completed: false,
        scheduleType: dto.scheduleType ?? ScheduleType.TASK,
        wbsCode: initialWbs.wbsCode,
        wbsSortKey: initialWbs.wbsSortKey,
        weightPercent: dto.weightPercent ?? null,
        isManuallyScheduled: dto.isManuallyScheduled ?? false,
        manualScheduleReason: dto.manualScheduleReason?.trim() ?? null,
        rank,
        deletedAt: null,
      });

      const saved = await tx.save(task);
      await this.wbsSvc.reserveExistingTaskCode(tx, saved, actorUser.id);
      await this.upsertActivitySchedule(tx, saved, dto);
      await this.createParentChecklistItemForSubtask(
        tx,
        parent,
        saved,
        actorUser,
      );

      if (assignedUsers.length) {
        await tx.save(
          assignedUsers.map(({ user, projectRoleId }) =>
            tx.create(TaskAssignee, {
              task: saved,
              taskId: saved.id,
              user,
              userId: user.id,
              projectRoleId,
            }),
          ),
        );
      }

      if (dto.checklistItems?.length) {
        await tx.save(
          dto.checklistItems.map((item) =>
            tx.create(TaskChecklistItem, {
              task: saved,
              taskId: saved.id,
              text: item.text.trim(),
              orderIndex: item.orderIndex,
              statusId: item.statusId ?? defaultStatus.id,
              rank: item.rank?.trim() || null,
              itemCode: item.itemCode?.trim() || null,
            }),
          ),
        );
      }

      for (const dependency of dependencyInputs) {
        const depTask = dependencyTaskById.get(dependency.dependsOnTaskId)!;
        await tx.save(
          tx.create(TaskDependency, {
            task: saved,
            taskId: saved.id,
            dependsOnTask: depTask,
            dependsOnTaskId: depTask.id,
            dependencyType: dependency.dependencyType,
            lagDays: dependency.lagDays,
          }),
        );
      }

      await this.relationsSvc.upsertViewMetadata(tx, saved, dto.viewMeta);
      if (defaultStatus.isDone === true) {
        await this.transitionSvc.applyTransition(tx, {
          projectId,
          task: saved,
          targetStatus: defaultStatus,
          actorUser,
        });
      }
      await this.activitySvc.log(
        tx,
        { ...saved, project },
        actorUser,
        TaskActionType.TASK_CREATED,
        { title: saved.title },
      );
      await this.progressSvc.recalculateProjectTaskProgress(tx, projectId);

      return saved;
    });

    await this.recalculateProjectSchedule(
      projectId,
      savedTask.id,
      'task-create',
    );

    return getTask(projectId, savedTask.id, requestUser, membership);
  }

  async updateTask(
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
    requestUser: RequestUser,
    getTask: (
      projectId: string,
      taskId: string,
      requestUser: RequestUser,
      membership?: ProjectMembership | null,
    ) => Promise<TaskSerializer>,
  ): Promise<TaskSerializer> {
    // Wave 1: fire all independent queries simultaneously.
    //
    // - verifyProjectPermission: 2 parallel queries internally (project + membership)
    // - taskRepo.findOne: core task only (ManyToOne relations only — no OneToMany).
    //   assignees/dependencyEdges/viewMetadataEntries are NOT loaded here because:
    //     • assignees       → re-fetched inside the tx via tx.find(TaskAssignee, ...)
    //     • dependencyEdges → re-fetched inside the tx via tx.find(TaskDependency, ...)
    //     • viewMetadataEntries → upsertViewMetadata queries fresh per viewType
    //   Removing them eliminates a 3-way Cartesian product on OneToMany relations.
    // - reporteeMembership / dependencyTasks / actorUser: independent of the task load.
    // - newStatus: pre-load outside the tx to avoid a sequential query inside it.
    //
    // Net: one wave instead of 3+ sequential round-trips.
    const dependencyInputs = this.normalizeDependencyInputs(dto);
    const [
      { membership },
      task,
      reporteeMembership,
      dependencyTasks,
      actorUser,
      newStatus,
    ] = await Promise.all([
      this.authSvc.verifyProjectPermission(projectId, requestUser, 'update'),
      this.taskRepo.findOne({
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['project', 'status'], // ManyToOne only — no Cartesian product
      }),
      dto.reportee !== undefined
        ? this.membersSvc.ensureReporteeMember(projectId, dto.reportee)
        : Promise.resolve(undefined),
      dependencyInputs !== undefined
        ? this.relationsSvc.ensureDependencyTasks(
            projectId,
            dependencyInputs.map((dependency) => dependency.dependsOnTaskId),
          )
        : Promise.resolve(undefined),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
      dto.statusId
        ? this.projectStatusRepo.findOne({
            where: { id: dto.statusId, projectId },
          })
        : Promise.resolve(null),
    ]);
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    const targetStatus = dto.statusId ? newStatus : task.status;
    if ((dto.statusId || dto.progress !== undefined) && !targetStatus) {
      throw new BadRequestException(
        'Target status is invalid for this project',
      );
    }
    await this.assertScheduleMutationAllowedForTaskUpdate(
      projectId,
      task.id,
      dto,
      requestUser,
      membership,
    );
    await this.assertChecklistMutationAllowedForTaskUpdate(
      projectId,
      task.id,
      dto,
      requestUser,
      membership,
    );
    await this.assertTeamMutationAllowedForTaskUpdate(
      projectId,
      task,
      dto,
      requestUser,
      membership,
      reporteeMembership?.userId,
    );
    const dependencyTaskById = new Map(
      (dependencyTasks ?? []).map((dependencyTask) => [
        dependencyTask.id,
        dependencyTask,
      ]),
    );

    const nextStartDate =
      dto.startDate !== undefined ? (dto.startDate ?? null) : task.startDate;
    const nextEndDate =
      dto.endDate !== undefined ? (dto.endDate ?? null) : task.endDate;
    this.authSvc.ensureDateRange(nextStartDate, nextEndDate);
    this.ensureScheduleDto(dto);

    const originalStatusId = task.statusId;
    const changedFields: string[] = [];

    if (dto.title !== undefined) {
      task.title = dto.title.trim();
      changedFields.push('title');
    }
    if (dto.description !== undefined) {
      task.description = dto.description ?? null;
      changedFields.push('description');
    }
    if (dto.statusId != null && dto.statusId !== task.statusId) {
      changedFields.push('statusId');
    }
    if (dto.progress !== undefined) {
      changedFields.push('progress');
      await this.assertLeafProgressMutationAllowed(projectId, task.id);
      if (task.completed && dto.progress !== 100) {
        throw new BadRequestException(
          'Completed leaf tasks must keep progress at 100',
        );
      }
    }
    if (dto.priorityId !== undefined) {
      task.priorityId = dto.priorityId ?? null;
      changedFields.push('priorityId');
    }
    if (dto.taskTypeId !== undefined) {
      task.taskTypeId = dto.taskTypeId;
      changedFields.push('taskTypeId');
    }
    if (dto.severityId !== undefined) {
      task.severityId = dto.severityId ?? null;
      changedFields.push('severityId');
    }
    if (dto.startDate !== undefined) {
      task.startDate = dto.startDate ?? null;
      changedFields.push('startDate');
    }
    if (dto.endDate !== undefined) {
      task.endDate = dto.endDate ?? null;
      changedFields.push('endDate');
    }
    if (dto.scheduleType !== undefined) {
      task.scheduleType = dto.scheduleType;
      changedFields.push('scheduleType');
    }
    const hasWbsChange =
      dto.wbsCode !== undefined || dto.wbsSortKey !== undefined;
    if (dto.weightPercent !== undefined) {
      task.weightPercent = dto.weightPercent ?? null;
      changedFields.push('weightPercent');
    }
    if (dto.isManuallyScheduled !== undefined) {
      task.isManuallyScheduled = dto.isManuallyScheduled;
      changedFields.push('isManuallyScheduled');
    }
    if (dto.manualScheduleReason !== undefined) {
      task.manualScheduleReason = dto.manualScheduleReason?.trim() ?? null;
      changedFields.push('manualScheduleReason');
    }
    if (dto.durationDays !== undefined) changedFields.push('durationDays');
    if (dto.plannedStartDate !== undefined)
      changedFields.push('plannedStartDate');
    if (dto.plannedEndDate !== undefined) changedFields.push('plannedEndDate');
    if (dto.actualStartDate !== undefined)
      changedFields.push('actualStartDate');
    if (dto.actualEndDate !== undefined) changedFields.push('actualEndDate');
    if (dto.reportee !== undefined) {
      task.reporteeUser = reporteeMembership!.user;
      task.reporteeUserId = reporteeMembership!.userId;
      changedFields.push('reportee');
    }

    await this.taskRepo.manager.transaction(async (tx) => {
      if (dto.statusId && dto.statusId !== originalStatusId) {
        await this.authSvc.assertWipLimit(tx, dto.statusId, projectId);
      }
      if (hasWbsChange) {
        await this.wbsSvc.applyTaskAssignment(
          tx,
          task,
          dto.wbsCode,
          dto.wbsSortKey,
          actorUser.id,
        );
        changedFields.push('wbsCode', 'wbsSortKey');
      }
      await tx.save(task);
      await this.upsertActivitySchedule(tx, task, dto);

      if (dto.assignedMembers !== undefined) {
        const assignedUsers = await this.membersSvc.ensureAssignedMembers(
          projectId,
          dto.assignedMembers,
          tx,
          actorUser,
        );
        const currentAssignees = await tx.find(TaskAssignee, {
          where: { taskId: task.id },
        });
        const currentIds = new Set(currentAssignees.map((a) => a.userId));
        const desiredIds = new Set(dto.assignedMembers.map((m) => m.userId));
        const toRemove = currentAssignees
          .filter((a) => !desiredIds.has(a.userId))
          .map((a) => a.id);
        const toAdd = assignedUsers.filter(
          ({ userId }) => !currentIds.has(userId),
        );
        if (toRemove.length)
          await tx.delete(TaskAssignee, { id: In(toRemove) });
        if (toAdd.length)
          await tx.save(
            toAdd.map(({ user, projectRoleId }) =>
              tx.create(TaskAssignee, {
                task,
                taskId: task.id,
                user,
                userId: user.id,
                projectRoleId,
              }),
            ),
          );
        changedFields.push('assignedMembers');
      }

      if (dto.checklistItems !== undefined) {
        await tx.delete(TaskChecklistItem, { taskId: task.id });
        if (dto.checklistItems.length) {
          await tx.save(
            dto.checklistItems.map((item) =>
              tx.create(TaskChecklistItem, {
                task,
                taskId: task.id,
                text: item.text.trim(),
                orderIndex: item.orderIndex,
                statusId: item.statusId ?? task.statusId,
                rank: item.rank?.trim() || null,
                itemCode: item.itemCode?.trim() || null,
              }),
            ),
          );
        }
        changedFields.push('checklistItems');
      }

      if (dependencyInputs !== undefined) {
        const existingDeps = await tx.find(TaskDependency, {
          where: { taskId: task.id },
        });
        const existingMap = new Map(
          existingDeps.map((d) => [d.dependsOnTaskId, d]),
        );
        const desiredMap = new Map(
          dependencyInputs.map((dependency) => [
            dependency.dependsOnTaskId,
            dependency,
          ]),
        );
        const desiredIds = new Set(desiredMap.keys());
        const toRemove = existingDeps
          .filter((d) => !desiredIds.has(d.dependsOnTaskId))
          .map((d) => d.id);
        if (toRemove.length)
          await tx.delete(TaskDependency, { id: In(toRemove) });
        for (const dependency of dependencyInputs) {
          const existing = existingMap.get(dependency.dependsOnTaskId);
          if (existing) {
            existing.dependencyType = dependency.dependencyType;
            existing.lagDays = dependency.lagDays;
            await tx.save(existing);
            continue;
          }
          const depTask = dependencyTaskById.get(dependency.dependsOnTaskId)!;
          await this.relationsSvc.ensureNoDependencyCycle(
            tx,
            task.id,
            depTask.id,
          );
          await tx.save(
            tx.create(TaskDependency, {
              task,
              taskId: task.id,
              dependsOnTask: depTask,
              dependsOnTaskId: depTask.id,
              dependencyType: dependency.dependencyType,
              lagDays: dependency.lagDays,
            }),
          );
        }
        changedFields.push(
          dto.dependencies !== undefined ? 'dependencies' : 'dependencyIds',
        );
      }

      if (dto.labelIds !== undefined) {
        const desiredIds = new Set((dto.labelIds ?? []).filter(Boolean));

        // Validate all requested label IDs belong to this project
        if (desiredIds.size > 0) {
          const validLabels = await tx.find(ProjectLabel, {
            where: { id: In([...desiredIds]), projectId },
          });
          if (validLabels.length !== desiredIds.size) {
            throw new BadRequestException(
              'One or more labelIds are invalid or do not belong to this project',
            );
          }
        }

        const currentLabels = await tx.find(TaskLabel, {
          where: { taskId: task.id },
        });
        const currentLabelIdSet = new Set(currentLabels.map((l) => l.labelId));
        const toRemoveIds = currentLabels
          .filter((l) => !desiredIds.has(l.labelId))
          .map((l) => l.id);
        const toAddLabelIds = [...desiredIds].filter(
          (id) => !currentLabelIdSet.has(id),
        );

        if (toRemoveIds.length)
          await tx.delete(TaskLabel, { id: In(toRemoveIds) });
        if (toAddLabelIds.length) {
          await tx.save(
            toAddLabelIds.map((labelId) =>
              tx.create(TaskLabel, { task, taskId: task.id, labelId }),
            ),
          );
        }
        changedFields.push('labels');
      }

      if (dto.viewMeta !== undefined) {
        await this.relationsSvc.upsertViewMetadata(tx, task, dto.viewMeta);
        changedFields.push('viewMeta');
      }

      const shouldApplyTransition =
        (dto.statusId != null && dto.statusId !== originalStatusId) ||
        dto.progress !== undefined;
      const transitionResult = shouldApplyTransition
        ? await this.transitionSvc.applyTransition(tx, {
            projectId,
            task,
            targetStatus: targetStatus!,
            actorUser,
            progress: dto.progress,
          })
        : null;
      if (transitionResult?.effects.rollupsRecalculated) {
        await this.progressSvc.recalculateProjectTaskProgress(tx, projectId);
      }

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          changedFields,
          transitionEffects: transitionResult?.effects ?? null,
          changedTaskIds: transitionResult?.changedTaskIds ?? [task.id],
        },
      );
    });

    await this.recalculateProjectSchedule(projectId, task.id, 'task-update');

    return getTask(projectId, task.id, requestUser, membership);
  }

  private ensureScheduleDto(dto: CreateTaskDto | UpdateTaskDto): void {
    this.authSvc.ensureDateRange(dto.plannedStartDate, dto.plannedEndDate);
    this.authSvc.ensureDateRange(dto.actualStartDate, dto.actualEndDate);
  }

  private async assertScheduleMutationAllowedForTaskUpdate(
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
    requestUser: RequestUser,
    membership: ProjectMembership | null,
  ): Promise<void> {
    if (!this.hasScheduleFieldChange(dto)) return;

    await this.authSvc.assertTaskSubresourceMutationAllowed({
      projectId,
      taskId,
      requestUser,
      resource: 'schedule',
      action: 'update',
      membership,
    });

    const existingScheduleCount = await this.activityScheduleRepo.count({
      where: { taskId },
    });
    if (existingScheduleCount > 0) return;

    await this.authSvc.assertTaskSubresourceMutationAllowed({
      projectId,
      taskId,
      requestUser,
      resource: 'schedule',
      action: 'create',
      membership,
    });
  }

  private hasScheduleFieldChange(
    dto: UpdateTaskDto | BulkUpdateTasksDto['items'][number],
  ): boolean {
    return (
      this.hasTaskScheduleFieldChange(dto) ||
      ('durationDays' in dto && dto.durationDays !== undefined) ||
      ('plannedStartDate' in dto && dto.plannedStartDate !== undefined) ||
      ('plannedEndDate' in dto && dto.plannedEndDate !== undefined) ||
      ('actualStartDate' in dto && dto.actualStartDate !== undefined) ||
      ('actualEndDate' in dto && dto.actualEndDate !== undefined)
    );
  }

  private hasTaskScheduleFieldChange(
    dto: UpdateTaskDto | BulkUpdateTasksDto['items'][number],
  ): boolean {
    return (
      dto.startDate !== undefined ||
      dto.endDate !== undefined ||
      dto.scheduleType !== undefined ||
      dto.isManuallyScheduled !== undefined ||
      dto.manualScheduleReason !== undefined
    );
  }

  private async assertChecklistMutationAllowedForTaskUpdate(
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
    requestUser: RequestUser,
    _membership: ProjectMembership | null,
  ): Promise<void> {
    if (dto.checklistItems === undefined) return;

    await this.authSvc.assertTaskOwnedChecklistManagementAllowed({
      projectId,
      taskId,
      requestUser,
    });
  }

  private async loadSingleActiveDoneStatus(
    projectId: string,
  ): Promise<ProjectStatus | null> {
    const doneStatuses = await this.projectStatusRepo.find({
      where: { projectId, isDone: true, isActive: true },
    });
    return doneStatuses.length === 1 ? doneStatuses[0] : null;
  }

  private async loadDefaultReopenStatus(
    projectId: string,
  ): Promise<ProjectStatus | null> {
    return this.projectStatusRepo
      .createQueryBuilder('status')
      .where('status.projectId = :projectId', { projectId })
      .andWhere('status.isActive = true')
      .andWhere('status.isDone = false')
      .orderBy('status.isDefault', 'DESC')
      .addOrderBy('status.orderIndex', 'ASC')
      .getOne();
  }

  private async assertTeamMutationAllowedForTaskUpdate(
    projectId: string,
    task: Task,
    dto: UpdateTaskDto,
    requestUser: RequestUser,
    membership: ProjectMembership | null,
    nextReporteeUserId?: string,
  ): Promise<void> {
    await this.assertAssigneeMutationAllowedForTaskUpdate(
      projectId,
      task.id,
      dto,
      requestUser,
      membership,
    );

    if (dto.reportee === undefined) return;
    if (!nextReporteeUserId || nextReporteeUserId === task.reporteeUserId) {
      return;
    }

    await this.authSvc.assertTaskSubresourceMutationAllowed({
      projectId,
      taskId: task.id,
      requestUser,
      resource: 'team.reportee',
      action: task.reporteeUserId ? 'update' : 'create',
      membership,
    });
  }

  private async assertAssigneeMutationAllowedForTaskUpdate(
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
    requestUser: RequestUser,
    membership: ProjectMembership | null,
  ): Promise<void> {
    if (dto.assignedMembers === undefined) return;

    const currentAssignees = await this.taskAssigneeRepo.find({
      where: { taskId },
      select: ['id', 'userId'],
    });
    const currentUserIds = new Set(
      currentAssignees.map((assignee) => assignee.userId),
    );
    const desiredUserIds = new Set(
      dto.assignedMembers.map((member) => member.userId),
    );

    const hasAdditions = [...desiredUserIds].some(
      (userId) => !currentUserIds.has(userId),
    );
    const hasRemovals = [...currentUserIds].some(
      (userId) => !desiredUserIds.has(userId),
    );

    if (hasAdditions) {
      await this.authSvc.assertTaskSubresourceMutationAllowed({
        projectId,
        taskId,
        requestUser,
        resource: 'team.assignee',
        action: 'create',
        membership,
      });
    }

    if (hasRemovals) {
      await this.authSvc.assertTaskSubresourceMutationAllowed({
        projectId,
        taskId,
        requestUser,
        resource: 'team.assignee',
        action: 'delete',
        membership,
      });
    }
  }

  private async assertLeafProgressMutationAllowed(
    projectId: string,
    taskId: string,
  ): Promise<void> {
    if (
      await this.checklistRepo.count({
        where: { taskId, packageManaged: true },
      })
    ) {
      throw new BadRequestException(
        'Task progress is derived from checklist work',
      );
    }
    const childCount = await this.taskRepo.count({
      where: { projectId, parentTaskId: taskId, deletedAt: IsNull() },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        'Parent task progress is automatically derived from subtasks',
      );
    }
  }

  private assertCompletedParentCanReceiveChild(
    parent: Task | null | undefined,
    childStatus: ProjectStatus,
  ): void {
    if (parent?.completed && childStatus.isDone !== true) {
      throw new BadRequestException(
        'Cannot add an incomplete subtask to a completed parent task',
      );
    }
  }

  private toBulkTaskUpdateFailure(
    taskId: string,
    error: unknown,
  ): BulkTaskUpdateFailure {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return {
          taskId,
          code: error.name,
          message: response,
        };
      }

      const body = response as {
        code?: string;
        message?: string | string[];
        details?: unknown;
        error?: string;
      };
      const message = Array.isArray(body.message)
        ? body.message.join(', ')
        : (body.message ?? body.error ?? error.message);

      return {
        taskId,
        code: body.code ?? error.name,
        message,
        ...(body.details !== undefined ? { details: body.details } : {}),
      };
    }

    return {
      taskId,
      code: 'BULK_TASK_UPDATE_FAILED',
      message: error instanceof Error ? error.message : 'Task update failed',
    };
  }

  private async recalculateProjectSchedule(
    projectId: string,
    triggerTaskId: string,
    triggerType: string,
  ): Promise<void> {
    await this.scheduleCalculationSvc.recalculateProject(projectId, {
      triggerTaskId,
      triggerType,
    });
  }

  private async createParentChecklistItemForSubtask(
    tx: EntityManager,
    parent: Task | null,
    subtask: Task,
    actorUser: User,
  ): Promise<void> {
    if (!parent) return;

    const orderIndex = await tx.count(TaskChecklistItem, {
      where: { taskId: parent.id },
    });
    const checklistItem = await tx.save(
      tx.create(TaskChecklistItem, {
        task: parent,
        taskId: parent.id,
        text: subtask.title,
        orderIndex,
        statusId: parent.statusId,
        rank: null,
        completed: false,
        completedByUserId: null,
        completedAt: null,
        checklistGroupId: null,
        itemCode: null,
        branchedTask: subtask,
        branchedTaskId: subtask.id,
        branchStatus: TaskChecklistBranchStatus.BRANCHED,
        branchedByUser: actorUser,
        branchedByUserId: actorUser.id,
        branchedAt: new Date(),
      }),
    );

    await this.activitySvc.log(
      tx,
      parent,
      actorUser,
      TaskActionType.CHECKLIST_UPDATED,
      {
        itemId: checklistItem.id,
        branchedTaskId: subtask.id,
        operation: 'subtask_checklist_item_created',
      },
    );
  }

  private normalizeDependencyInputs(
    dto: CreateTaskDto | UpdateTaskDto,
  ): NormalizedTaskDependencyInput[] | undefined {
    if (dto.dependencies !== undefined && dto.dependencyIds !== undefined) {
      throw new BadRequestException(
        'Send either dependencies or dependencyIds, not both',
      );
    }

    const dependencies =
      dto.dependencies !== undefined
        ? dto.dependencies.map((dependency) => ({
            dependsOnTaskId: dependency.dependsOnTaskId,
            dependencyType:
              dependency.dependencyType ?? DependencyType.FINISH_TO_START,
            lagDays: dependency.lagDays ?? 0,
          }))
        : dto.dependencyIds?.map((dependsOnTaskId) => ({
            dependsOnTaskId,
            dependencyType: DependencyType.FINISH_TO_START,
            lagDays: 0,
          }));

    if (dependencies === undefined) return undefined;

    const uniquePredecessorIds = new Set(
      dependencies.map((dependency) => dependency.dependsOnTaskId),
    );
    if (uniquePredecessorIds.size !== dependencies.length) {
      throw new BadRequestException(
        'Duplicate task dependencies are not allowed',
      );
    }

    return dependencies;
  }

  private async upsertActivitySchedule(
    tx: EntityManager,
    task: Task,
    dto: CreateTaskDto | UpdateTaskDto,
  ): Promise<void> {
    const schedule =
      (await tx.findOne(TaskActivitySchedule, {
        where: { taskId: task.id },
      })) ??
      tx.create(TaskActivitySchedule, {
        task,
        taskId: task.id,
        durationDays: this.defaultDurationDays(task.scheduleType),
        isCritical: false,
        isManuallyScheduled: false,
      });

    const plannedDateChanged =
      dto.plannedStartDate !== undefined || dto.plannedEndDate !== undefined;
    const nextIsManual =
      dto.isManuallyScheduled ?? schedule.isManuallyScheduled ?? false;
    const nextManualReason =
      dto.manualScheduleReason !== undefined
        ? (dto.manualScheduleReason?.trim() ?? null)
        : schedule.manualReason;

    if (plannedDateChanged && !nextIsManual) {
      throw new BadRequestException(
        'isManuallyScheduled must be true when manually changing planned schedule dates',
      );
    }
    if (nextIsManual && !nextManualReason) {
      throw new BadRequestException(
        'manualScheduleReason is required when manually pinning activity schedule dates',
      );
    }

    if (dto.durationDays !== undefined) {
      schedule.durationDays = dto.durationDays ?? null;
    } else {
      schedule.durationDays =
        schedule.durationDays ?? this.defaultDurationDays(task.scheduleType);
    }
    if (dto.plannedStartDate !== undefined) {
      schedule.plannedStartDate = dto.plannedStartDate ?? null;
    }
    if (dto.plannedEndDate !== undefined) {
      schedule.plannedEndDate = dto.plannedEndDate ?? null;
    }
    if (dto.actualStartDate !== undefined) {
      schedule.actualStartDate = dto.actualStartDate ?? null;
    }
    if (dto.actualEndDate !== undefined) {
      schedule.actualEndDate = dto.actualEndDate ?? null;
    }
    if (dto.isManuallyScheduled !== undefined) {
      schedule.isManuallyScheduled = dto.isManuallyScheduled;
    }
    if (dto.manualScheduleReason !== undefined) {
      schedule.manualReason = nextManualReason;
    }

    await tx.save(TaskActivitySchedule, schedule);
  }

  private defaultDurationDays(scheduleType: ScheduleType): number {
    return scheduleType === ScheduleType.TASK ||
      scheduleType === ScheduleType.ACTIVITY
      ? 1
      : 0;
  }

  async moveTask(
    projectId: string,
    taskId: string,
    dto: MoveTaskDto,
    requestUser: RequestUser,
    getTask: (
      projectId: string,
      taskId: string,
      requestUser: RequestUser,
      membership?: ProjectMembership | null,
    ) => Promise<TaskSerializer>,
  ): Promise<TaskSerializer> {
    // All three are independent — fire in one wave
    const [{ membership }, task, actorUser] = await Promise.all([
      this.authSvc.verifyProjectPermission(projectId, requestUser, 'update'),
      this.taskRepo.findOne({
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['project', 'status'],
      }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    const sourceScope = this.rankingSvc.buildScope(
      projectId,
      task.parentTaskId,
      task.statusId,
    );
    const nextParentTaskId =
      dto.parentTaskId !== undefined
        ? (dto.parentTaskId ?? null)
        : task.parentTaskId;
    const nextStatusId: string =
      dto.statusId != null ? dto.statusId : task.statusId;
    const targetStatus =
      nextStatusId === task.statusId && task.status
        ? task.status
        : await this.projectStatusRepo.findOne({
            where: { id: nextStatusId, projectId },
          });
    if (!targetStatus) {
      throw new BadRequestException(
        'Target status is invalid for this project',
      );
    }

    await this.rankingSvc.assertNotDescendant(
      projectId,
      task.id,
      nextParentTaskId,
    );
    const parent = await this.authSvc.ensureParentTask(
      projectId,
      nextParentTaskId,
    );
    this.assertCompletedParentCanReceiveChild(parent, targetStatus);

    await this.taskRepo.manager.transaction(async (tx) => {
      if (dto.statusId && dto.statusId !== task.statusId) {
        await this.authSvc.assertWipLimit(tx, dto.statusId, projectId);
      }

      if (dto.completionMode === TaskCompletionMode.VALIDATE_ONLY) {
        await this.transitionSvc.applyTransition(tx, {
          projectId,
          task,
          targetStatus,
          actorUser,
          completionMode: dto.completionMode,
          progress: dto.progress,
          reason: dto.reason,
        });
        return;
      }

      const destinationScope = this.rankingSvc.buildScope(
        projectId,
        parent?.id ?? null,
        nextStatusId,
      );
      const nextRank = await this.rankingSvc.calculateRankWithinScope(
        tx,
        destinationScope,
        dto.beforeTaskId,
        dto.afterTaskId,
        task.id,
      );

      task.parent = parent ?? null;
      task.parentTaskId = parent?.id ?? null;
      task.rank = nextRank;

      const shouldApplyTransition =
        task.statusId !== nextStatusId ||
        dto.progress !== undefined ||
        dto.completionMode !== undefined;
      const transitionResult = shouldApplyTransition
        ? await this.transitionSvc.applyTransition(tx, {
            projectId,
            task,
            targetStatus,
            actorUser,
            completionMode: dto.completionMode,
            progress: dto.progress,
            reason: dto.reason,
          })
        : null;

      if (!shouldApplyTransition) {
        task.statusId = nextStatusId;
        await tx.save(task);
      }
      const movedAcrossScope =
        sourceScope.parentTaskId !== destinationScope.parentTaskId ||
        sourceScope.statusId !== destinationScope.statusId;
      if (movedAcrossScope || transitionResult?.effects.rollupsRecalculated) {
        await this.progressSvc.recalculateProjectTaskProgress(tx, projectId);
      }
      await this.rankingSvc.rebalanceScopeRanks(tx, destinationScope);

      if (movedAcrossScope) {
        await this.rankingSvc.rebalanceScopeRanks(tx, sourceScope);
      }

      const refreshed = await tx.findOne(Task, { where: { id: task.id } });
      if (refreshed?.rank) task.rank = refreshed.rank;

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_MOVED,
        {
          parentTaskId: task.parentTaskId,
          statusId: task.statusId,
          rank: task.rank,
          completionMode: dto.completionMode ?? null,
          transitionEffects: transitionResult?.effects ?? null,
          changedTaskIds: transitionResult?.changedTaskIds ?? [task.id],
        },
      );
    });

    return getTask(projectId, task.id, requestUser, membership);
  }

  async completeTask(
    projectId: string,
    taskId: string,
    dto: CompleteTaskDto,
    requestUser: RequestUser,
    getTask: (
      projectId: string,
      taskId: string,
      requestUser: RequestUser,
      membership?: ProjectMembership | null,
    ) => Promise<TaskSerializer>,
  ): Promise<CompleteTaskResponse | ValidateTaskCompletionResponse> {
    const [{ membership }, task, actorUser, targetStatus] = await Promise.all([
      this.authSvc.verifyProjectPermission(projectId, requestUser, 'update'),
      this.taskRepo.findOne({
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['project', 'status'],
      }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
      dto.statusId
        ? this.projectStatusRepo.findOne({
            where: { id: dto.statusId, projectId },
          })
        : this.loadSingleActiveDoneStatus(projectId),
    ]);
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    if (!targetStatus) {
      throw new BadRequestException(
        'Project must have exactly one active Done status or provide statusId.',
      );
    }
    if (targetStatus.isDone !== true) {
      throw new UnprocessableEntityException({
        message: INVALID_DONE_STATUS,
        code: 'INVALID_DONE_STATUS',
        details: { statusId: targetStatus.id },
      });
    }

    if (dto.completionMode === TaskCompletionMode.VALIDATE_ONLY) {
      if (task.statusId !== targetStatus.id) {
        await this.authSvc.assertWipLimit(
          this.taskRepo.manager,
          targetStatus.id,
          projectId,
        );
      }

      const validationResult = await this.transitionSvc.applyTransition(
        this.taskRepo.manager,
        {
          projectId,
          task,
          targetStatus,
          actorUser,
          completionMode: TaskCompletionMode.VALIDATE_ONLY,
          reason: dto.reason,
        },
      );

      return {
        allowed: true,
        taskId: task.id,
        statusId: targetStatus.id,
        effects: validationResult.effects,
        changedTaskIds: [],
        warnings: validationResult.warnings,
      };
    }

    const alreadyCompleteInTargetDone =
      task.completed === true &&
      task.status?.isDone === true &&
      task.statusId === targetStatus.id;
    if (alreadyCompleteInTargetDone) {
      return {
        task: await getTask(projectId, task.id, requestUser, membership),
        effects: {
          checklistItemsCompleted: 0,
          descendantTasksCompleted: 0,
          rollupsRecalculated: false,
        },
        changedTaskIds: [],
        warnings: [],
      };
    }

    let transitionResult: Awaited<
      ReturnType<TaskCompletionTransitionService['applyTransition']>
    >;
    await this.taskRepo.manager.transaction(async (tx) => {
      const previousStatusId = task.statusId;
      if (task.statusId !== targetStatus.id) {
        await this.authSvc.assertWipLimit(tx, targetStatus.id, projectId);
      }

      transitionResult = await this.transitionSvc.applyTransition(tx, {
        projectId,
        task,
        targetStatus,
        actorUser,
        completionMode: dto.completionMode,
        reason: dto.reason,
      });
      if (transitionResult.effects.rollupsRecalculated) {
        await this.progressSvc.recalculateProjectTaskProgress(tx, projectId);
      }

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_COMPLETED,
        {
          previousStatusId,
          nextStatusId: targetStatus.id,
          completionMode: dto.completionMode ?? null,
          reason: dto.reason ?? null,
          transitionEffects: transitionResult.effects,
          changedTaskIds: transitionResult.changedTaskIds,
        },
      );
    });

    return {
      task: await getTask(projectId, task.id, requestUser, membership),
      effects: transitionResult!.effects,
      changedTaskIds: transitionResult!.changedTaskIds,
      warnings: transitionResult!.warnings,
    };
  }

  async reopenTask(
    projectId: string,
    taskId: string,
    dto: ReopenTaskDto,
    requestUser: RequestUser,
    getTask: (
      projectId: string,
      taskId: string,
      requestUser: RequestUser,
      membership?: ProjectMembership | null,
    ) => Promise<TaskSerializer>,
  ): Promise<ReopenTaskResponse> {
    const [{ membership }, task, actorUser, targetStatus] = await Promise.all([
      this.authSvc.verifyProjectPermission(projectId, requestUser, 'update'),
      this.taskRepo.findOne({
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['project', 'status'],
      }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
      dto.statusId
        ? this.projectStatusRepo.findOne({
            where: { id: dto.statusId, projectId },
          })
        : this.loadDefaultReopenStatus(projectId),
    ]);
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    if (
      !targetStatus ||
      targetStatus.isActive !== true ||
      targetStatus.isDone
    ) {
      throw new UnprocessableEntityException({
        message: INVALID_REOPEN_STATUS,
        code: 'INVALID_REOPEN_STATUS',
        details: { statusId: dto.statusId ?? null },
      });
    }
    if (task.status?.isDone !== true && task.completed !== true) {
      throw new BadRequestException('Task is not completed');
    }
    if (dto.progress !== undefined) {
      await this.assertLeafProgressMutationAllowed(projectId, task.id);
    }

    const previousStatusId = task.statusId;
    const previousProgress = task.progress;

    await this.taskRepo.manager.transaction(async (tx) => {
      if (task.statusId !== targetStatus.id) {
        await this.authSvc.assertWipLimit(tx, targetStatus.id, projectId);
      }

      const transitionResult = await this.transitionSvc.applyTransition(tx, {
        projectId,
        task,
        targetStatus,
        actorUser,
        progress: dto.progress,
        reason: dto.reason,
      });
      if (transitionResult.effects.rollupsRecalculated) {
        await this.progressSvc.recalculateProjectTaskProgress(tx, projectId);
      }

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          operation: 'task_reopened',
          previousStatusId,
          nextStatusId: targetStatus.id,
          previousProgress,
          nextProgress: dto.progress ?? task.progress,
          reason: dto.reason ?? null,
          transitionEffects: transitionResult.effects,
          changedTaskIds: transitionResult.changedTaskIds,
        },
      );
    });

    const reopenedTask = await getTask(
      projectId,
      task.id,
      requestUser,
      membership,
    );

    return {
      task: reopenedTask,
      audit: {
        previousStatusId,
        nextStatusId: targetStatus.id,
        previousProgress,
        nextProgress: reopenedTask.progress,
        reason: dto.reason ?? null,
      },
    };
  }

  async updateTaskProgress(
    projectId: string,
    taskId: string,
    dto: UpdateTaskProgressDto,
    requestUser: RequestUser,
    getTask: (
      projectId: string,
      taskId: string,
      requestUser: RequestUser,
      membership?: ProjectMembership | null,
    ) => Promise<TaskSerializer>,
  ): Promise<{
    task: TaskSerializer;
    audit: {
      previousProgress: number | null;
      nextProgress: number;
      source: string | null;
      note: string | null;
    };
  }> {
    const [{ membership }, task, actorUser] = await Promise.all([
      this.authSvc.verifyProjectPermission(projectId, requestUser, 'update'),
      this.taskRepo.findOne({
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['project'],
      }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    await this.assertLeafProgressMutationAllowed(projectId, task.id);
    if (task.completed && dto.progress !== 100) {
      throw new BadRequestException(
        'Completed leaf tasks must keep progress at 100',
      );
    }

    const previousProgress = task.progress;
    task.progress = dto.progress;

    await this.taskRepo.manager.transaction(async (tx) => {
      await tx.save(Task, task);
      await this.progressSvc.recalculateProjectTaskProgress(tx, projectId);
      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_PROGRESS_CHANGED,
        {
          previousProgress,
          nextProgress: dto.progress,
          source: dto.source ?? null,
          note: dto.note ?? null,
        },
      );
    });

    return {
      task: await getTask(projectId, task.id, requestUser, membership),
      audit: {
        previousProgress,
        nextProgress: dto.progress,
        source: dto.source ?? null,
        note: dto.note ?? null,
      },
    };
  }

  async supersedeTask(
    projectId: string,
    taskId: string,
    dto: SupersedeTaskDto,
    requestUser: RequestUser,
    getTask: (
      projectId: string,
      taskId: string,
      requestUser: RequestUser,
      membership?: ProjectMembership | null,
    ) => Promise<TaskSerializer>,
  ): Promise<{
    supersededTask: TaskSerializer;
    replacementTask: TaskSerializer;
  }> {
    if (taskId === dto.replacementTaskId) {
      throw new BadRequestException(INVALID_TASK_SUPERSESSION);
    }

    const [{ membership }, actorUser, tasks] = await Promise.all([
      this.authSvc.verifyProjectPermission(projectId, requestUser, 'update'),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
      this.taskRepo.find({
        where: {
          id: In([taskId, dto.replacementTaskId]),
          projectId,
          deletedAt: IsNull(),
        },
        relations: ['project'],
      }),
    ]);

    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const supersededTask = taskMap.get(taskId);
    const replacementTask = taskMap.get(dto.replacementTaskId);
    if (!supersededTask || !replacementTask) {
      throw new BadRequestException(INVALID_TASK_SUPERSESSION);
    }
    if (supersededTask.supersededByTaskId) {
      throw new BadRequestException(TASK_ALREADY_SUPERSEDED);
    }
    if (replacementTask.supersedesTaskId) {
      throw new BadRequestException(TASK_REPLACEMENT_ALREADY_USED);
    }

    await this.taskRepo.manager.transaction(async (tx) => {
      const now = new Date();
      supersededTask.supersededByTask = replacementTask;
      supersededTask.supersededByTaskId = replacementTask.id;
      supersededTask.supersessionReason = dto.reason?.trim() ?? null;
      supersededTask.supersededAt = now;

      replacementTask.supersedesTask = supersededTask;
      replacementTask.supersedesTaskId = supersededTask.id;

      await tx.save(Task, [supersededTask, replacementTask]);

      await this.activitySvc.log(
        tx,
        supersededTask,
        actorUser,
        TaskActionType.TASK_SUPERSEDED,
        {
          supersededByTaskId: replacementTask.id,
          supersessionReason: supersededTask.supersessionReason,
          supersededAt: now.toISOString(),
        },
      );
      await this.activitySvc.log(
        tx,
        replacementTask,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          supersedesTaskId: supersededTask.id,
          operation: 'task_supersession_replacement_linked',
        },
      );
    });

    const [updatedSupersededTask, updatedReplacementTask] = await Promise.all([
      getTask(projectId, supersededTask.id, requestUser, membership),
      getTask(projectId, replacementTask.id, requestUser, membership),
    ]);

    return {
      supersededTask: updatedSupersededTask,
      replacementTask: updatedReplacementTask,
    };
  }

  async bulkUpdateTasks(
    projectId: string,
    dto: BulkUpdateTasksDto,
    requestUser: RequestUser,
  ): Promise<BulkTaskUpdateResponse> {
    const requestedIds = [...new Set(dto.items.map((item) => item.taskId))];
    const requestedStatusIds = [
      ...new Set(
        dto.items
          .map((item) => item.statusId)
          .filter((statusId): statusId is string => Boolean(statusId)),
      ),
    ];
    const progressTaskIds = dto.items
      .filter((item) => item.progress !== undefined)
      .map((item) => item.taskId);

    // Three independent queries — fire in one wave
    const [{ membership }, actorUser, tasks, statuses, progressChildRows] =
      await Promise.all([
        this.authSvc.verifyProjectPermission(projectId, requestUser, 'update'),
        this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
        this.taskRepo.find({
          where: { id: In(requestedIds), projectId, deletedAt: IsNull() },
          relations: ['project', 'status'],
        }),
        requestedStatusIds.length
          ? this.projectStatusRepo.find({
              where: { id: In(requestedStatusIds), projectId },
            })
          : Promise.resolve([]),
        progressTaskIds.length
          ? this.taskRepo
              .createQueryBuilder('task')
              .select('task.parentTaskId', 'parentTaskId')
              .addSelect('COUNT(task.id)', 'childCount')
              .where('task.projectId = :projectId', { projectId })
              .andWhere('task.parentTaskId IN (:...taskIds)', {
                taskIds: progressTaskIds,
              })
              .andWhere('task.deletedAt IS NULL')
              .groupBy('task.parentTaskId')
              .getRawMany<{ parentTaskId: string; childCount: string }>()
          : Promise.resolve([]),
      ]);

    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const statusMap = new Map(statuses.map((status) => [status.id, status]));
    const progressParentTaskIds = new Set(
      progressChildRows
        .filter((row) => Number(row.childCount) > 0)
        .map((row) => row.parentTaskId),
    );
    const succeeded: string[] = [];
    const failed: BulkTaskUpdateFailure[] = [];
    const failedTaskIds = new Set<string>();
    const changedTaskIds = new Set<string>();

    for (const item of dto.items) {
      const task = taskMap.get(item.taskId);
      if (!task || !this.hasTaskScheduleFieldChange(item)) continue;
      try {
        await this.authSvc.assertTaskSubresourceMutationAllowed({
          projectId,
          taskId: task.id,
          requestUser,
          resource: 'schedule',
          action: 'update',
          membership,
        });
      } catch (error) {
        failed.push(this.toBulkTaskUpdateFailure(item.taskId, error));
        failedTaskIds.add(item.taskId);
      }
    }

    for (const item of dto.items) {
      if (failedTaskIds.has(item.taskId)) continue;
      const initialTask = taskMap.get(item.taskId);
      if (!initialTask) {
        failed.push({
          taskId: item.taskId,
          code: 'TASK_NOT_FOUND',
          message: TASK_NOT_FOUND,
        });
        failedTaskIds.add(item.taskId);
        continue;
      }

      try {
        await this.taskRepo.manager.transaction(async (tx) => {
          const task = await tx.findOne(Task, {
            where: { id: item.taskId, projectId, deletedAt: IsNull() },
            relations: ['project', 'status'],
          });
          if (!task) throw new NotFoundException(TASK_NOT_FOUND);

          if (item.progress !== undefined) {
            if (progressParentTaskIds.has(task.id)) {
              throw new BadRequestException(
                'Parent task progress is automatically derived from subtasks',
              );
            }
            if (task.completed && item.progress !== 100) {
              throw new BadRequestException(
                'Completed leaf tasks must keep progress at 100',
              );
            }
          }

          const nextStartDate =
            item.startDate !== undefined
              ? (item.startDate ?? null)
              : task.startDate;
          const nextEndDate =
            item.endDate !== undefined ? (item.endDate ?? null) : task.endDate;
          this.authSvc.ensureDateRange(nextStartDate, nextEndDate);

          const nextParentTaskId =
            item.parentTaskId !== undefined
              ? (item.parentTaskId ?? null)
              : task.parentTaskId;

          if (item.parentTaskId !== undefined) {
            await this.rankingSvc.assertNotDescendant(
              projectId,
              task.id,
              nextParentTaskId,
            );
          }

          const parent =
            item.parentTaskId !== undefined
              ? await this.authSvc.ensureParentTask(projectId, nextParentTaskId)
              : undefined;

          let movedScope = false;

          const previousStatusId = task.statusId;
          const nextStatusId = item.statusId ?? task.statusId;
          const targetStatus =
            nextStatusId === task.statusId && task.status
              ? task.status
              : statusMap.get(nextStatusId);
          if (!targetStatus) {
            throw new BadRequestException(
              'Target status is invalid for this project',
            );
          }
          this.assertCompletedParentCanReceiveChild(parent, targetStatus);
          if (item.statusId && nextStatusId !== previousStatusId) {
            await this.authSvc.assertWipLimit(tx, nextStatusId, projectId);
          }
          if (item.priorityId !== undefined)
            task.priorityId = item.priorityId ?? null;
          if (item.taskTypeId !== undefined) task.taskTypeId = item.taskTypeId;
          if (item.severityId !== undefined)
            task.severityId = item.severityId ?? null;
          if (item.scheduleType !== undefined)
            task.scheduleType = item.scheduleType;
          const hasWbsChange =
            item.wbsCode !== undefined || item.wbsSortKey !== undefined;
          if (hasWbsChange) {
            await this.wbsSvc.applyTaskAssignment(
              tx,
              task,
              item.wbsCode,
              item.wbsSortKey,
              actorUser.id,
            );
          }
          if (item.weightPercent !== undefined)
            task.weightPercent = item.weightPercent ?? null;
          if (item.isManuallyScheduled !== undefined)
            task.isManuallyScheduled = item.isManuallyScheduled;
          if (item.manualScheduleReason !== undefined)
            task.manualScheduleReason =
              item.manualScheduleReason?.trim() ?? null;
          if (item.startDate !== undefined)
            task.startDate = item.startDate ?? null;
          if (item.endDate !== undefined) task.endDate = item.endDate ?? null;
          if (item.parentTaskId !== undefined) {
            task.parent = parent ?? null;
            task.parentTaskId = parent?.id ?? null;
            movedScope = true;
          }
          if (item.statusId !== undefined) movedScope = true;

          if (movedScope) {
            task.rank = await this.rankingSvc.calculateRankWithinScope(
              tx,
              this.rankingSvc.buildScope(
                projectId,
                task.parentTaskId,
                nextStatusId,
              ),
              undefined,
              undefined,
              task.id,
            );
          }

          const shouldApplyTransition =
            nextStatusId !== previousStatusId || item.progress !== undefined;
          const transitionResult = shouldApplyTransition
            ? await this.transitionSvc.applyTransition(tx, {
                projectId,
                task,
                targetStatus,
                actorUser,
                progress: item.progress,
              })
            : null;
          if (!shouldApplyTransition) {
            task.statusId = nextStatusId;
            await tx.save(task);
          }
          if (item.viewMeta !== undefined)
            await this.relationsSvc.upsertViewMetadata(tx, task, item.viewMeta);

          await this.activitySvc.log(
            tx,
            task,
            actorUser,
            movedScope
              ? TaskActionType.TASK_MOVED
              : TaskActionType.TASK_UPDATED,
            {
              statusId: task.statusId,
              scheduleType: item.scheduleType,
              wbsCode: item.wbsCode,
              wbsSortKey: item.wbsSortKey,
              weightPercent: item.weightPercent,
              isManuallyScheduled: item.isManuallyScheduled,
              manualScheduleReason: item.manualScheduleReason,
              startDate: item.startDate,
              endDate: item.endDate,
              parentTaskId: task.parentTaskId,
              viewMetaUpdated: item.viewMeta !== undefined,
              transitionEffects: transitionResult?.effects ?? null,
            },
          );
          await this.progressSvc.recalculateProjectTaskProgress(tx, projectId);

          succeeded.push(task.id);
          changedTaskIds.add(task.id);
          for (const changedTaskId of transitionResult?.changedTaskIds ?? []) {
            changedTaskIds.add(changedTaskId);
          }
        });
      } catch (error) {
        failed.push(this.toBulkTaskUpdateFailure(item.taskId, error));
        failedTaskIds.add(item.taskId);
      }
    }

    const tasksForList = succeeded.length
      ? await this.authSvc.loadTasksForList([...new Set(succeeded)], projectId)
      : [];

    return {
      tasks: tasksForList,
      succeeded: [...new Set(succeeded)],
      failed,
      changedTaskIds: [...changedTaskIds],
    };
  }

  async deleteTask(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true; deletedTaskCount: number }> {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'delete',
    );

    const [task, actorUser, allLiveTasks] = await Promise.all([
      this.taskRepo.findOne({
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['project'],
      }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
      this.taskRepo.find({
        where: { projectId, deletedAt: IsNull() },
        select: ['id', 'parentTaskId'],
      }),
    ]);
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    const sourceScope = this.rankingSvc.buildScope(
      projectId,
      task.parentTaskId,
      task.statusId,
    );
    const toDelete = new Set<string>([task.id]);
    const queue = [task.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const candidate of allLiveTasks) {
        if (
          candidate.parentTaskId === currentId &&
          !toDelete.has(candidate.id)
        ) {
          toDelete.add(candidate.id);
          queue.push(candidate.id);
        }
      }
    }

    await this.taskRepo.manager.transaction(async (tx) => {
      await tx.update(
        Task,
        { id: In([...toDelete]) },
        { deletedAt: new Date() },
      );
      await this.rankingSvc.rebalanceScopeRanks(tx, sourceScope);
      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_DELETED,
        { deletedCount: toDelete.size },
      );
      await this.progressSvc.recalculateProjectTaskProgress(tx, projectId);
    });

    return { id: taskId, success: true, deletedTaskCount: toDelete.size };
  }
}
