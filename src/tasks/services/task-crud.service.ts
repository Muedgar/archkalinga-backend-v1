import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { User } from 'src/users/entities';
import {
  BulkUpdateTasksDto,
  CreateTaskDto,
  MoveTaskDto,
  UpdateTaskDto,
} from '../dtos';
import {
  Task,
  TaskActionType,
  TaskAssignee,
  TaskChecklistItem,
  TaskDependency,
  TaskLabel,
} from '../entities';
import { ProjectLabel, ProjectStatus, ProjectTaskType } from '../project-config';
import { TASK_NOT_FOUND } from '../messages';
import { TaskListItemSerializer, TaskSerializer } from '../serializers';
import { TaskActivityService } from './task-activity.service';
import { TaskAuthService } from './task-auth.service';
import { TaskMembersService } from './task-members.service';
import { TaskRankingService } from './task-ranking.service';
import { TaskRelationsService } from './task-relations.service';

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
    private readonly authSvc: TaskAuthService,
    private readonly rankingSvc: TaskRankingService,
    private readonly activitySvc: TaskActivityService,
    private readonly membersSvc: TaskMembersService,
    private readonly relationsSvc: TaskRelationsService,
  ) {}

  async createTask(
    projectId: string,
    dto: CreateTaskDto,
    requestUser: RequestUser,
    getTask: (projectId: string, taskId: string, requestUser: RequestUser) => Promise<TaskSerializer>,
  ): Promise<TaskSerializer> {
    const { project } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'create');

    const [parent, reporteeMembership, dependencyTasks, actorUser] = await Promise.all([
      this.authSvc.ensureParentTask(projectId, dto.parentTaskId),
      dto.reportee !== undefined ? this.membersSvc.ensureReporteeMember(projectId, dto.reportee) : Promise.resolve(null),
      this.relationsSvc.ensureDependencyTasks(projectId, dto.dependencyIds ?? []),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    this.authSvc.ensureDateRange(dto.startDate, dto.endDate);

    const [defaultStatus, defaultTaskType] = await Promise.all([
      dto.statusId
        ? this.projectStatusRepo.findOne({ where: { id: dto.statusId, projectId } })
        : this.projectStatusRepo.findOne({ where: { projectId, isDefault: true } }),
      dto.taskTypeId
        ? this.projectTaskTypeRepo.findOne({ where: { id: dto.taskTypeId, projectId } })
        : this.projectTaskTypeRepo.findOne({ where: { projectId, isDefault: true } }),
    ]);

    if (!defaultStatus)   throw new BadRequestException('Project has no default status. Provide statusId.');
    if (!defaultTaskType) throw new BadRequestException('Project has no default task type. Provide taskTypeId.');

    const savedTask = await this.taskRepo.manager.transaction(async (tx) => {
      await this.authSvc.assertWipLimit(tx, defaultStatus.id, projectId);

      const assignedUsers = dto.assignedMembers !== undefined
        ? await this.membersSvc.ensureAssignedMembers(projectId, dto.assignedMembers, tx, actorUser)
        : [];

      const rank = await this.rankingSvc.getNextRank(tx, projectId, parent?.id ?? null, defaultStatus.id);

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
        reporteeUser: reporteeMembership?.user ?? null,
        reporteeUserId: reporteeMembership?.userId ?? null,
        title: dto.title.trim(),
        description: dto.description ?? null,
        startDate: dto.startDate ?? null,
        endDate: dto.endDate ?? null,
        progress: dto.progress ?? null,
        completed: defaultStatus.isTerminal,
        rank,
        deletedAt: null,
      });

      const saved = await tx.save(task);

      if (assignedUsers.length) {
        await tx.save(
          assignedUsers.map(({ user }) =>
            tx.create(TaskAssignee, { task: saved, taskId: saved.id, user, userId: user.id }),
          ),
        );
      }

      if (dto.checklistItems?.length) {
        await tx.save(
          dto.checklistItems.map((item) =>
            tx.create(TaskChecklistItem, { task: saved, taskId: saved.id, text: item.text.trim(), orderIndex: item.orderIndex }),
          ),
        );
      }

      for (const depTask of dependencyTasks) {
        await tx.save(
          tx.create(TaskDependency, { task: saved, taskId: saved.id, dependsOnTask: depTask, dependsOnTaskId: depTask.id }),
        );
      }

      await this.relationsSvc.upsertViewMetadata(tx, saved, dto.viewMeta);
      await this.activitySvc.log(tx, { ...saved, project }, actorUser, TaskActionType.TASK_CREATED, { title: saved.title });

      return saved;
    });

    return getTask(projectId, savedTask.id, requestUser);
  }

  async updateTask(
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
    requestUser: RequestUser,
    getTask: (projectId: string, taskId: string, requestUser: RequestUser) => Promise<TaskSerializer>,
  ): Promise<TaskSerializer> {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');

    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
      relations: ['project', 'assignees', 'dependencyEdges', 'viewMetadataEntries', 'reporteeUser'],
    });
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    const [reporteeMembership, dependencyTasks, actorUser] = await Promise.all([
      dto.reportee !== undefined ? this.membersSvc.ensureReporteeMember(projectId, dto.reportee) : Promise.resolve(undefined),
      dto.dependencyIds !== undefined ? this.relationsSvc.ensureDependencyTasks(projectId, dto.dependencyIds) : Promise.resolve(undefined),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    const nextStartDate = dto.startDate !== undefined ? (dto.startDate ?? null) : task.startDate;
    const nextEndDate   = dto.endDate   !== undefined ? (dto.endDate   ?? null) : task.endDate;
    this.authSvc.ensureDateRange(nextStartDate, nextEndDate);

    const originalStatusId = task.statusId;
    const changedFields: string[] = [];

    if (dto.title       !== undefined) { task.title       = dto.title.trim();        changedFields.push('title'); }
    if (dto.description !== undefined) { task.description = dto.description ?? null;  changedFields.push('description'); }
    if (dto.statusId    !== undefined) {
      task.statusId = dto.statusId ?? task.statusId;
      changedFields.push('statusId');
      if (dto.statusId) {
        const newStatus = await this.projectStatusRepo.findOne({ where: { id: dto.statusId, projectId } });
        if (newStatus) task.completed = newStatus.isTerminal;
      }
    }
    if (dto.priorityId !== undefined) { task.priorityId = dto.priorityId ?? null; changedFields.push('priorityId'); }
    if (dto.taskTypeId !== undefined) { task.taskTypeId = dto.taskTypeId;          changedFields.push('taskTypeId'); }
    if (dto.severityId !== undefined) { task.severityId = dto.severityId ?? null;  changedFields.push('severityId'); }
    if (dto.startDate  !== undefined) { task.startDate  = dto.startDate  ?? null;  changedFields.push('startDate'); }
    if (dto.endDate    !== undefined) { task.endDate    = dto.endDate    ?? null;  changedFields.push('endDate'); }
    if (dto.progress   !== undefined) { task.progress   = dto.progress   ?? null;  changedFields.push('progress'); }
    if (dto.reportee   !== undefined) {
      task.reporteeUser   = reporteeMembership!.user;
      task.reporteeUserId = reporteeMembership!.userId;
      changedFields.push('reportee');
    }

    await this.taskRepo.manager.transaction(async (tx) => {
      if (dto.statusId && task.statusId !== originalStatusId) {
        await this.authSvc.assertWipLimit(tx, task.statusId, projectId);
      }
      await tx.save(task);

      if (dto.assignedMembers !== undefined) {
        const assignedUsers = await this.membersSvc.ensureAssignedMembers(projectId, dto.assignedMembers, tx, actorUser);
        const currentAssignees = await tx.find(TaskAssignee, { where: { taskId: task.id } });
        const currentIds  = new Set(currentAssignees.map((a) => a.userId));
        const desiredIds  = new Set(dto.assignedMembers.map((m) => m.userId));
        const toRemove = currentAssignees.filter((a) => !desiredIds.has(a.userId)).map((a) => a.id);
        const toAdd    = assignedUsers.filter(({ userId }) => !currentIds.has(userId));
        if (toRemove.length) await tx.delete(TaskAssignee, { id: In(toRemove) });
        if (toAdd.length)    await tx.save(toAdd.map(({ user }) => tx.create(TaskAssignee, { task, taskId: task.id, user, userId: user.id })));
        changedFields.push('assignedMembers');
      }

      if (dto.checklistItems !== undefined) {
        await tx.delete(TaskChecklistItem, { taskId: task.id });
        if (dto.checklistItems.length) {
          await tx.save(
            dto.checklistItems.map((item) =>
              tx.create(TaskChecklistItem, { task, taskId: task.id, text: item.text.trim(), orderIndex: item.orderIndex }),
            ),
          );
        }
        changedFields.push('checklistItems');
      }

      if (dto.dependencyIds !== undefined) {
        const existingDeps = await tx.find(TaskDependency, { where: { taskId: task.id } });
        const existingMap  = new Map(existingDeps.map((d) => [d.dependsOnTaskId, d]));
        const desiredIds   = new Set(dto.dependencyIds);
        const toRemove = existingDeps.filter((d) => !desiredIds.has(d.dependsOnTaskId)).map((d) => d.id);
        if (toRemove.length) await tx.delete(TaskDependency, { id: In(toRemove) });
        for (const depTask of dependencyTasks ?? []) {
          if (existingMap.has(depTask.id)) continue;
          await this.relationsSvc.ensureNoDependencyCycle(tx, task.id, depTask.id);
          await tx.save(tx.create(TaskDependency, { task, taskId: task.id, dependsOnTask: depTask, dependsOnTaskId: depTask.id }));
        }
        changedFields.push('dependencyIds');
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

        const currentLabels = await tx.find(TaskLabel, { where: { taskId: task.id } });
        const currentLabelIdSet = new Set(currentLabels.map((l) => l.labelId));
        const toRemoveIds = currentLabels
          .filter((l) => !desiredIds.has(l.labelId))
          .map((l) => l.id);
        const toAddLabelIds = [...desiredIds].filter((id) => !currentLabelIdSet.has(id));

        if (toRemoveIds.length) await tx.delete(TaskLabel, { id: In(toRemoveIds) });
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

      await this.activitySvc.log(tx, task, actorUser, TaskActionType.TASK_UPDATED, { changedFields });
    });

    return getTask(projectId, task.id, requestUser);
  }

  async moveTask(
    projectId: string,
    taskId: string,
    dto: MoveTaskDto,
    requestUser: RequestUser,
    getTask: (projectId: string, taskId: string, requestUser: RequestUser) => Promise<TaskSerializer>,
  ): Promise<TaskSerializer> {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');

    const [task, actorUser] = await Promise.all([
      this.taskRepo.findOne({ where: { id: taskId, projectId, deletedAt: IsNull() }, relations: ['project'] }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    const sourceScope     = this.rankingSvc.buildScope(projectId, task.parentTaskId, task.statusId);
    const nextParentTaskId = dto.parentTaskId !== undefined ? (dto.parentTaskId ?? null) : task.parentTaskId;
    const nextStatusId: string = dto.statusId != null ? dto.statusId : task.statusId;

    await this.rankingSvc.assertNotDescendant(projectId, task.id, nextParentTaskId);
    const parent = await this.authSvc.ensureParentTask(projectId, nextParentTaskId);

    await this.taskRepo.manager.transaction(async (tx) => {
      const destinationScope = this.rankingSvc.buildScope(projectId, parent?.id ?? null, nextStatusId);
      const nextRank = await this.rankingSvc.calculateRankWithinScope(tx, destinationScope, dto.beforeTaskId, dto.afterTaskId, task.id);

      task.parent      = parent ?? null;
      task.parentTaskId = parent?.id ?? null;
      task.statusId    = nextStatusId;
      task.rank        = nextRank;

      await tx.save(task);
      await this.rankingSvc.rebalanceScopeRanks(tx, destinationScope);

      if (sourceScope.parentTaskId !== destinationScope.parentTaskId || sourceScope.statusId !== destinationScope.statusId) {
        await this.rankingSvc.rebalanceScopeRanks(tx, sourceScope);
      }

      const refreshed = await tx.findOne(Task, { where: { id: task.id } });
      if (refreshed?.rank) task.rank = refreshed.rank;

      await this.activitySvc.log(tx, task, actorUser, TaskActionType.TASK_MOVED, {
        parentTaskId: task.parentTaskId,
        statusId: task.statusId,
        rank: task.rank,
      });
    });

    return getTask(projectId, task.id, requestUser);
  }

  async bulkUpdateTasks(
    projectId: string,
    dto: BulkUpdateTasksDto,
    requestUser: RequestUser,
  ): Promise<TaskListItemSerializer[]> {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');

    const actorUser    = await this.userRepo.findOneOrFail({ where: { id: requestUser.id } });
    const requestedIds = [...new Set(dto.items.map((item) => item.taskId))];
    const tasks        = await this.taskRepo.find({
      where: { id: In(requestedIds), projectId, deletedAt: IsNull() },
      relations: ['project'],
    });

    const taskMap       = new Map(tasks.map((t) => [t.id, t]));
    const updatedTaskIds: string[] = [];

    await this.taskRepo.manager.transaction(async (tx) => {
      for (const item of dto.items) {
        const task = taskMap.get(item.taskId);
        if (!task) continue;

        const nextStartDate  = item.startDate  !== undefined ? (item.startDate  ?? null) : task.startDate;
        const nextEndDate    = item.endDate    !== undefined ? (item.endDate    ?? null) : task.endDate;
        this.authSvc.ensureDateRange(nextStartDate, nextEndDate);

        const nextParentTaskId = item.parentTaskId !== undefined ? (item.parentTaskId ?? null) : task.parentTaskId;

        if (item.parentTaskId !== undefined) {
          await this.rankingSvc.assertNotDescendant(projectId, task.id, nextParentTaskId);
        }

        const parent = item.parentTaskId !== undefined
          ? await this.authSvc.ensureParentTask(projectId, nextParentTaskId)
          : undefined;

        let movedScope = false;

        if (item.statusId !== undefined) {
          const prevStatusId = task.statusId;
          task.statusId = item.statusId ?? task.statusId;
          if (item.statusId && task.statusId !== prevStatusId) {
            await this.authSvc.assertWipLimit(tx, task.statusId, projectId);
          }
        }
        if (item.priorityId   !== undefined) task.priorityId  = item.priorityId  ?? null;
        if (item.taskTypeId   !== undefined) task.taskTypeId  = item.taskTypeId;
        if (item.severityId   !== undefined) task.severityId  = item.severityId  ?? null;
        if (item.progress     !== undefined) task.progress    = item.progress;
        if (item.startDate    !== undefined) task.startDate   = item.startDate   ?? null;
        if (item.endDate      !== undefined) task.endDate     = item.endDate     ?? null;
        if (item.parentTaskId !== undefined) { task.parent = parent ?? null; task.parentTaskId = parent?.id ?? null; movedScope = true; }
        if (item.statusId     !== undefined) movedScope = true;

        if (movedScope) {
          task.rank = await this.rankingSvc.calculateRankWithinScope(
            tx,
            this.rankingSvc.buildScope(projectId, task.parentTaskId, task.statusId),
            undefined, undefined, task.id,
          );
        }

        await tx.save(task);
        if (item.viewMeta !== undefined) await this.relationsSvc.upsertViewMetadata(tx, task, item.viewMeta);

        await this.activitySvc.log(
          tx, task, actorUser,
          movedScope ? TaskActionType.TASK_MOVED : TaskActionType.TASK_UPDATED,
          { statusId: task.statusId, progress: item.progress, startDate: item.startDate, endDate: item.endDate, parentTaskId: task.parentTaskId, viewMetaUpdated: item.viewMeta !== undefined },
        );
        updatedTaskIds.push(task.id);
      }
    });

    return this.authSvc.loadTasksForList(updatedTaskIds, projectId);
  }

  async deleteTask(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true; deletedTaskCount: number }> {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'delete');

    const [task, actorUser, allLiveTasks] = await Promise.all([
      this.taskRepo.findOne({ where: { id: taskId, projectId, deletedAt: IsNull() }, relations: ['project'] }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
      this.taskRepo.find({ where: { projectId, deletedAt: IsNull() }, select: ['id', 'parentTaskId'] }),
    ]);
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    const sourceScope = this.rankingSvc.buildScope(projectId, task.parentTaskId, task.statusId);
    const toDelete    = new Set<string>([task.id]);
    const queue       = [task.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const candidate of allLiveTasks) {
        if (candidate.parentTaskId === currentId && !toDelete.has(candidate.id)) {
          toDelete.add(candidate.id);
          queue.push(candidate.id);
        }
      }
    }

    await this.taskRepo.manager.transaction(async (tx) => {
      await tx.update(Task, { id: In([...toDelete]) }, { deletedAt: new Date() });
      await this.rankingSvc.rebalanceScopeRanks(tx, sourceScope);
      await this.activitySvc.log(tx, task, actorUser, TaskActionType.TASK_DELETED, { deletedCount: toDelete.size });
    });

    return { id: taskId, success: true, deletedTaskCount: toDelete.size };
  }
}
