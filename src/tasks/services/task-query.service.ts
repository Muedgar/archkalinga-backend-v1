import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { FilterResponse } from 'src/common/interfaces';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import { Task, TaskComment } from '../entities';
import { TaskFiltersDto } from '../dtos';
import { TASK_NOT_FOUND, TASK_PROJECT_ACCESS_DENIED } from '../messages';
import { TaskListItemSerializer, TaskSerializer } from '../serializers';
import { TaskAuthService } from './task-auth.service';
import { TaskMembersService } from './task-members.service';

@Injectable()
export class TaskQueryService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskComment)
    private readonly commentRepo: Repository<TaskComment>,
    private readonly authSvc: TaskAuthService,
    private readonly membersSvc: TaskMembersService,
  ) {}

  async getTask(projectId: string, taskId: string, requestUser: RequestUser): Promise<TaskSerializer> {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    const task = await this.authSvc.loadTaskOrFail(taskId, projectId);

    const viewScope = (membership?.projectRole?.permissions?.taskManagement as any)?.viewScope ?? 'all';
    if (viewScope === 'assigned') {
      const isAssignee = (task.assignees ?? []).some((a) => a.userId === requestUser.id);
      const isReportee = task.reporteeUserId === requestUser.id;
      if (!isAssignee && !isReportee) throw new ForbiddenException(TASK_PROJECT_ACCESS_DENIED);
    }

    const counts     = await this.membersSvc.computeCounts(task.id, this.commentRepo);
    const roleContext = await this.membersSvc.loadProjectRoleContextMap(
      projectId,
      [...[task.reporteeUserId].filter((v): v is string => Boolean(v)), ...(task.assignees ?? []).map((a) => a.userId)],
    );

    return this.authSvc.toTaskSerializer(this.membersSvc.buildTaskReadModel(task, roleContext, counts));
  }

  async getProjectTasks(
    projectId: string,
    filters: TaskFiltersDto,
    requestUser: RequestUser,
  ): Promise<FilterResponse<TaskListItemSerializer> & { meta: { projectId: string; flat: boolean } }> {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');

    const viewScope = (membership?.projectRole?.permissions?.taskManagement as any)?.viewScope ?? 'all';
    if (viewScope === 'assigned') filters = { ...filters, assignedUserId: requestUser.id };

    const includes     = this.authSvc.parseIncludes(filters.include);
    const page         = filters.page  ?? 1;
    const limit        = filters.limit ?? 10;
    const includeDeleted = filters.includeDeleted === true && this.authSvc.isAdmin(requestUser);

    const qb = this.taskRepo.createQueryBuilder('task').where('task.projectId = :projectId', { projectId });
    if (!includeDeleted) qb.andWhere('task.deletedAt IS NULL');

    // ── Hierarchy filter ──────────────────────────────────────────────────
    if (filters.parentTaskId === 'root')   qb.andWhere('task.parentTaskId IS NULL');
    else if (filters.parentTaskId)         qb.andWhere('task.parentTaskId = :parentTaskId', { parentTaskId: filters.parentTaskId });
    else if (filters.flat === false)       qb.andWhere('task.parentTaskId IS NULL');

    // ── Scalar FK filters ─────────────────────────────────────────────────
    if (filters.statusId)   qb.andWhere('task.statusId = :statusId',     { statusId: filters.statusId });
    if (filters.priorityId) qb.andWhere('task.priorityId = :priorityId', { priorityId: filters.priorityId });
    if (filters.taskTypeId) qb.andWhere('task.taskTypeId = :taskTypeId', { taskTypeId: filters.taskTypeId });
    if (filters.severityId) qb.andWhere('task.severityId = :severityId', { severityId: filters.severityId });

    // ── Assignee filter (EXISTS subquery avoids duplicate rows) ───────────
    if (filters.assignedUserId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM "task_assignees" "ta_f" WHERE "ta_f"."taskId" = task.id AND "ta_f"."userId" = :assignedUserId)`,
        { assignedUserId: filters.assignedUserId },
      );
    }

    if (filters.reporteeUserId) qb.andWhere('task.reporteeUserId = :reporteeUserId', { reporteeUserId: filters.reporteeUserId });

    // ── Role filter ───────────────────────────────────────────────────────
    if (filters.projectRoleId) {
      qb.andWhere(
        `(EXISTS (
            SELECT 1 FROM "task_assignees" "ta_r"
            INNER JOIN "project_memberships" "pm_r"
              ON "pm_r"."projectId" = task."projectId"
             AND "pm_r"."userId" = "ta_r"."userId"
             AND "pm_r"."status" = :ams
            WHERE "ta_r"."taskId" = task.id AND "pm_r"."projectRoleId" = :projectRoleId
          ) OR EXISTS (
            SELECT 1 FROM "project_memberships" "pm_rep"
            WHERE "pm_rep"."projectId" = task."projectId"
              AND "pm_rep"."userId" = task."reporteeUserId"
              AND "pm_rep"."status" = :ams
              AND "pm_rep"."projectRoleId" = :projectRoleId
          ))`,
        { projectRoleId: filters.projectRoleId, ams: MembershipStatus.ACTIVE },
      );
    }

    // ── Text & date filters ───────────────────────────────────────────────
    if (filters.search)        qb.andWhere('task.title ILIKE :search',               { search: `%${filters.search}%` });
    if (filters.startDateFrom) qb.andWhere('task.startDate >= :startDateFrom',       { startDateFrom: filters.startDateFrom });
    if (filters.startDateTo)   qb.andWhere('task.startDate <= :startDateTo',         { startDateTo: filters.startDateTo });
    if (filters.endDateFrom)   qb.andWhere('task.endDate >= :endDateFrom',           { endDateFrom: filters.endDateFrom });
    if (filters.endDateTo)     qb.andWhere('task.endDate <= :endDateTo',             { endDateTo: filters.endDateTo });

    // ── Checklist completion filter ───────────────────────────────────────
    if (filters.hasIncompleteChecklist === true) {
      qb.andWhere(`EXISTS (SELECT 1 FROM "task_checklist_items" "tci" WHERE "tci"."taskId" = task.id AND "tci"."completed" = false)`);
    } else if (filters.hasIncompleteChecklist === false) {
      qb.andWhere(`NOT EXISTS (SELECT 1 FROM "task_checklist_items" "tci" WHERE "tci"."taskId" = task.id AND "tci"."completed" = false)`);
    }

    // ── Always-on joins (assignees, config FKs) ───────────────────────────
    qb.leftJoinAndSelect('task.assignees',    'assignees')
      .leftJoinAndSelect('assignees.user',    'assigneeUser')
      .leftJoinAndSelect('task.reporteeUser', 'reporteeUser')
      .leftJoinAndSelect('task.status',       'status')
      .leftJoinAndSelect('task.priority',     'priority')
      .leftJoinAndSelect('task.taskType',     'taskType')
      .leftJoinAndSelect('task.severity',     'severity');

    // ── Optional includes ─────────────────────────────────────────────────
    if (includes.has('checklist'))    qb.leftJoinAndSelect('task.checklistItems',     'checklistItems');
    if (includes.has('dependencies')) qb.leftJoinAndSelect('task.dependencyEdges',    'dependencyEdges');
    if (includes.has('comments'))     qb.leftJoinAndSelect('task.comments', 'comments', 'comments.deletedAt IS NULL');
    if (includes.has('viewMeta'))     qb.leftJoinAndSelect('task.viewMetadataEntries', 'viewMetadataEntries');

    qb.loadRelationCountAndMap('task.childCount', 'task.children', 'children', (sub) =>
      sub.andWhere('children.deletedAt IS NULL'),
    );

    // ── Order & pagination ────────────────────────────────────────────────
    const orderByAllowed = new Set(['title', 'status', 'priority', 'startDate', 'endDate', 'rank', 'createdAt', 'updatedAt']);
    const orderBy  = filters.orderBy && orderByAllowed.has(filters.orderBy) ? `task.${filters.orderBy}` : 'task.createdAt';
    qb.orderBy(orderBy, filters.sortOrder ?? 'DESC').skip((page - 1) * limit).take(limit);

    const [tasks, count] = await qb.getManyAndCount();

    // ── Batch comment counts (avoids double-join when include=comments) ───
    const commentCountMap = new Map<string, number>();
    if (tasks.length > 0) {
      const rows = await this.commentRepo
        .createQueryBuilder('c')
        .select('c.taskId', 'taskId')
        .addSelect('COUNT(c.id)', 'cnt')
        .where('c.taskId IN (:...ids)', { ids: tasks.map((t) => t.id) })
        .andWhere('c.deletedAt IS NULL')
        .groupBy('c.taskId')
        .getRawMany<{ taskId: string; cnt: string }>();
      for (const row of rows) commentCountMap.set(row.taskId, Number(row.cnt));
    }

    const roleContext = await this.membersSvc.loadProjectRoleContextMap(
      projectId,
      tasks.flatMap((t) =>
        [t.reporteeUserId, ...(t.assignees ?? []).map((a) => a.userId)].filter((v): v is string => Boolean(v)),
      ),
    );

    return {
      items: tasks.map((task) =>
        this.authSvc.toTaskListItemSerializer(
          this.membersSvc.buildTaskReadModel(task, roleContext, {
            childCount: (task as any).childCount ?? 0,
            commentCount: commentCountMap.get(task.id) ?? 0,
          }),
        ),
      ),
      meta: { projectId, flat: filters.flat ?? true },
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async findOneOrFail(taskId: string, projectId: string): Promise<Task> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, projectId, deletedAt: IsNull() } });
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    return task;
  }
}
