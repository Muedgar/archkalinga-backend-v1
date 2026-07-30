import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { OutboxService } from 'src/outbox/outbox.service';
import { ProjectActivityLog } from 'src/projects/entities';
import { User } from 'src/users/entities';
import {
  TaskSnapshotQueryDto,
  TaskTimelineOrder,
  TaskTimelineQueryDto,
  TaskTimelineScope,
} from '../dtos';
import { TaskActivityLog, TaskActionType, Task } from '../entities';
import { TaskAuthService } from './task-auth.service';

const DEFAULT_TIMELINE_LIMIT = 100;
const DEFAULT_TIMELINE_DEPTH = 25;

type TaskTimelineEvent = {
  id: string;
  taskId: string;
  actionType: TaskActionType;
  actionMeta: Record<string, unknown> | null;
  actorUser: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  actorName: string | null;
  createdAt: Date;
};

@Injectable()
export class TaskActivityService {
  constructor(
    @InjectRepository(TaskActivityLog)
    private readonly taskActivityLogRepo: Repository<TaskActivityLog>,
    @InjectRepository(ProjectActivityLog)
    private readonly projectActivityLogRepo: Repository<ProjectActivityLog>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly outboxService: OutboxService,
    private readonly authSvc: TaskAuthService,
  ) {}

  // ── Map action enum → outbox event string ────────────────────────────────────

  static toEventType(action: TaskActionType): string {
    switch (action) {
      case TaskActionType.TASK_CREATED:
        return 'task.created';
      case TaskActionType.TASK_UPDATED:
        return 'task.updated';
      case TaskActionType.TASK_MOVED:
        return 'task.moved';
      case TaskActionType.TASK_SUPERSEDED:
        return 'task.superseded';
      case TaskActionType.TASK_DELETED:
        return 'task.deleted';
      case TaskActionType.TASK_ASSIGNED:
        return 'task.assigned';
      case TaskActionType.TASK_UNASSIGNED:
        return 'task.unassigned';
      case TaskActionType.COMMENT_ADDED:
        return 'task.comment.added';
      case TaskActionType.STATUS_CHANGED:
        return 'task.status.changed';
      case TaskActionType.CHECKLIST_UPDATED:
        return 'task.checklist.updated';
      case TaskActionType.DEPENDENCY_ADDED:
        return 'task.dependency.added';
      case TaskActionType.DEPENDENCY_REMOVED:
        return 'task.dependency.removed';
      default:
        return `task.${String(action).toLowerCase()}`;
    }
  }

  // ── Write task + project activity logs and an outbox event atomically ────────

  async log(
    manager: EntityManager,
    task: Pick<Task, 'id' | 'projectId' | 'project'>,
    actorUser: User,
    actionType: TaskActionType,
    actionMeta?: Record<string, unknown> | null,
  ): Promise<void> {
    const actorName =
      [actorUser.firstName, actorUser.lastName].filter(Boolean).join(' ') ||
      actorUser.email;

    // Save both log rows concurrently (independent inserts — no FK between them)
    await Promise.all([
      manager.save(
        manager.create(TaskActivityLog, {
          projectId: task.projectId,
          taskId: task.id,
          actorUser: { pkid: actorUser.pkid },
          actorUserId: actorUser.id,
          actorName,
          actionType,
          actionMeta: actionMeta ?? {},
        }),
      ),
      manager.save(
        manager.create(ProjectActivityLog, {
          project: task.project?.pkid
            ? { pkid: task.project.pkid }
            : undefined,
          projectId: task.projectId,
          user: { pkid: actorUser.pkid },
          userId: actorUser.id,
          taskId: task.id,
          actionType,
          actionMeta: actionMeta ?? {},
        }),
      ),
    ]);

    await this.outboxService.record(manager, {
      aggregateType: 'task',
      aggregateId: task.id,
      eventType: TaskActivityService.toEventType(actionType),
      payload: {
        taskId: task.id,
        projectId: task.projectId,
        actorUserId: actorUser.id,
        ...(actionMeta ?? {}),
      },
    });
  }

  /**
   * Batch-log multiple task activities in a single transaction pass.
   * Each entry produces a TaskActivityLog, a ProjectActivityLog, and an outbox event.
   * All log rows are batch-saved at the end (two INSERT ... VALUES ... statements),
   * then outbox events are saved individually (they need separate IDs).
   *
   * Use this in bulk operations (e.g. bulkUpdateTasks) instead of calling log() in a loop.
   */
  async logBatch(
    manager: EntityManager,
    entries: Array<{
      task: Pick<Task, 'id' | 'projectId' | 'project'>;
      actorUser: User;
      actionType: TaskActionType;
      actionMeta?: Record<string, unknown> | null;
    }>,
  ): Promise<void> {
    if (!entries.length) return;

    const taskLogs: TaskActivityLog[] = [];
    const projectLogs: ProjectActivityLog[] = [];

    for (const { task, actorUser, actionType, actionMeta } of entries) {
      const actorName =
        [actorUser.firstName, actorUser.lastName].filter(Boolean).join(' ') ||
        actorUser.email;

      taskLogs.push(
        manager.create(TaskActivityLog, {
          projectId: task.projectId,
          taskId: task.id,
          actorUser: { pkid: actorUser.pkid },
          actorUserId: actorUser.id,
          actorName,
          actionType,
          actionMeta: actionMeta ?? {},
        }),
      );

      projectLogs.push(
        manager.create(ProjectActivityLog, {
          project: task.project?.pkid
            ? { pkid: task.project.pkid }
            : undefined,
          projectId: task.projectId,
          user: { pkid: actorUser.pkid },
          userId: actorUser.id,
          taskId: task.id,
          actionType,
          actionMeta: actionMeta ?? {},
        }),
      );
    }

    // Two batch INSERTs instead of 2N serial saves
    await Promise.all([
      manager.save(TaskActivityLog, taskLogs),
      manager.save(ProjectActivityLog, projectLogs),
    ]);

    // Outbox events need individual records (each gets its own UUID/row)
    for (const { task, actorUser, actionType, actionMeta } of entries) {
      await this.outboxService.record(manager, {
        aggregateType: 'task',
        aggregateId: task.id,
        eventType: TaskActivityService.toEventType(actionType),
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          actorUserId: actorUser.id,
          ...(actionMeta ?? {}),
        },
      });
    }
  }

  // ── Paginated activity list for a single task ─────────────────────────────

  async listForTask(
    taskId: string,
    page: number,
    limit: number,
  ): Promise<{
    items: {
      id: string;
      taskId: string;
      actionType: TaskActionType;
      actionMeta: Record<string, unknown> | null;
      actorUser: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
      } | null;
      createdAt: Date;
    }[];
    count: number;
    page: number;
    limit: number;
  }> {
    const [logs, count] = await this.taskActivityLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actorUser', 'actorUser')
      .where('log.taskId = :taskId', { taskId })
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: logs.map((log) => ({
        id: log.id,
        taskId: log.taskId,
        actionType: log.actionType,
        actionMeta: log.actionMeta,
        actorUser: log.actorUser
          ? {
              id: log.actorUser.id,
              firstName: log.actorUser.firstName,
              lastName: log.actorUser.lastName,
              email: log.actorUser.email,
            }
          : null,
        createdAt: log.createdAt,
      })),
      count,
      page,
      limit,
    };
  }

  async listTimeline(
    projectId: string,
    rootTaskId: string,
    query: TaskTimelineQueryDto,
    requestUser: RequestUser,
  ): Promise<{
    items: TaskTimelineEvent[];
    count: number;
    page: number;
    limit: number;
    meta: {
      projectId: string;
      rootTaskId: string;
      scope: TaskTimelineScope;
      from: string | null;
      to: string | null;
      order: TaskTimelineOrder;
      taskIds: string[];
      subtreeDepth: number;
      subtreeTruncated: boolean;
      reconstructionBasis: string;
    };
  }> {
    const scope = query.scope ?? TaskTimelineScope.TASK;
    const order = query.order ?? TaskTimelineOrder.ASC;
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_TIMELINE_LIMIT;
    const from = this.parseOptionalDate(query.from, 'from');
    const to = this.parseOptionalDate(query.to, 'to');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('from must be before to');
    }

    const scopeResult = await this.resolveTaskScope(
      projectId,
      rootTaskId,
      scope,
      query.depth,
      requestUser,
    );

    const qb = this.taskActivityLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actorUser', 'actorUser')
      .where('log.projectId = :projectId', { projectId })
      .andWhere('log.taskId IN (:...taskIds)', {
        taskIds: scopeResult.taskIds,
      });

    if (from) qb.andWhere('log.createdAt >= :from', { from });
    if (to) qb.andWhere('log.createdAt <= :to', { to });

    const [logs, count] = await qb
      .orderBy(
        'log.createdAt',
        order === TaskTimelineOrder.ASC ? 'ASC' : 'DESC',
      )
      .addOrderBy('log.id', order === TaskTimelineOrder.ASC ? 'ASC' : 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items: logs.map((log) => this.toTimelineEvent(log)),
      count,
      page,
      limit,
      meta: {
        projectId,
        rootTaskId,
        scope,
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        order,
        taskIds: scopeResult.taskIds,
        subtreeDepth: scopeResult.maxDepthVisited,
        subtreeTruncated: scopeResult.truncated,
        reconstructionBasis:
          scope === TaskTimelineScope.SUBTREE
            ? 'activity-log-events-for-current-visible-subtree'
            : 'activity-log-events-for-task',
      },
    };
  }

  async getSnapshot(
    projectId: string,
    rootTaskId: string,
    query: TaskSnapshotQueryDto,
    requestUser: RequestUser,
  ): Promise<{
    asOf: string;
    scope: TaskTimelineScope;
    rootTaskId: string;
    tasks: Array<{
      id: string;
      parentTaskId: string | null;
      title: string;
      wbsCode: string | null;
      wbsSortKey: string | null;
      statusId: string;
      status: unknown;
      priorityId: string | null;
      taskTypeId: string;
      severityId: string | null;
      startDate: string | null;
      endDate: string | null;
      progress: number | null;
      completed: boolean;
      supersededByTaskId: string | null;
      supersedesTaskId: string | null;
      supersessionReason: string | null;
      supersededAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }>;
    eventSummary: {
      eventCountThroughAsOf: number;
      latestEventAtOrBefore: Date | null;
      firstEventAtOrBefore: Date | null;
    };
    meta: {
      projectId: string;
      taskIds: string[];
      subtreeDepth: number;
      subtreeTruncated: boolean;
      stateAccuracy: string;
      limitations: string[];
    };
  }> {
    const asOf = this.parseRequiredDate(query.asOf, 'asOf');
    const scope = query.scope ?? TaskTimelineScope.TASK;
    const scopeResult = await this.resolveTaskScope(
      projectId,
      rootTaskId,
      scope,
      query.depth,
      requestUser,
    );

    const [tasks, eventSummary] = await Promise.all([
      this.taskRepo
        .createQueryBuilder('task')
        .leftJoinAndSelect('task.status', 'status')
        .leftJoinAndSelect('task.priority', 'priority')
        .leftJoinAndSelect('task.taskType', 'taskType')
        .leftJoinAndSelect('task.severity', 'severity')
        .where('task.projectId = :projectId', { projectId })
        .andWhere('task.id IN (:...taskIds)', {
          taskIds: scopeResult.taskIds,
        })
        .andWhere('task.createdAt <= :asOf', { asOf })
        .andWhere('(task.deletedAt IS NULL OR task.deletedAt > :asOf)', {
          asOf,
        })
        .orderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
        .addOrderBy('task.createdAt', 'ASC')
        .getMany(),
      this.loadEventSummary(projectId, scopeResult.taskIds, asOf),
    ]);

    return {
      asOf: asOf.toISOString(),
      scope,
      rootTaskId,
      tasks: tasks.map((task) => ({
        id: task.id,
        parentTaskId: task.parentTaskId,
        title: task.title,
        wbsCode: task.wbsCode,
        wbsSortKey: task.wbsSortKey,
        statusId: task.statusId,
        status: task.status ?? null,
        priorityId: task.priorityId,
        taskTypeId: task.taskTypeId,
        severityId: task.severityId,
        startDate: task.startDate,
        endDate: task.endDate,
        progress: task.progress,
        completed: task.completed,
        supersededByTaskId: task.supersededByTaskId,
        supersedesTaskId: task.supersedesTaskId,
        supersessionReason: task.supersessionReason,
        supersededAt: task.supersededAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        deletedAt: task.deletedAt,
      })),
      eventSummary,
      meta: {
        projectId,
        taskIds: scopeResult.taskIds,
        subtreeDepth: scopeResult.maxDepthVisited,
        subtreeTruncated: scopeResult.truncated,
        stateAccuracy:
          'partial_current_values_with_historical_existence_and_event_cutoff',
        limitations: [
          'The activity stream is historical and time-filtered.',
          'Task field values are current values for tasks that existed at the requested time.',
          'Exact field-level state replay requires before/after values in every activity event payload.',
          'Subtree membership follows the current visible task hierarchy.',
        ],
      },
    };
  }

  private async resolveTaskScope(
    projectId: string,
    rootTaskId: string,
    scope: TaskTimelineScope,
    depth: number | undefined,
    requestUser: RequestUser,
  ): Promise<{
    taskIds: string[];
    maxDepthVisited: number;
    truncated: boolean;
  }> {
    if (scope === TaskTimelineScope.TASK) {
      return {
        taskIds: [rootTaskId],
        maxDepthVisited: 0,
        truncated: false,
      };
    }

    const maxDepth = depth ?? DEFAULT_TIMELINE_DEPTH;
    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
    );
    const taskIds = [rootTaskId];
    let frontierIds = [rootTaskId];
    let level = 0;
    let truncated = false;

    while (frontierIds.length && level < maxDepth) {
      const qb = this.taskRepo
        .createQueryBuilder('task')
        .select(['task.id'])
        .where('task.projectId = :projectId', { projectId })
        .andWhere('task.parentTaskId IN (:...frontierIds)', { frontierIds })
        .andWhere('task.deletedAt IS NULL')
        .orderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
        .addOrderBy('task.rank', 'ASC', 'NULLS LAST')
        .addOrderBy('task.createdAt', 'ASC');

      this.authSvc.applyTaskVisibilityScope(
        qb,
        requestUser,
        canViewAllProjectTasks,
      );

      const children = await qb.getMany();
      if (!children.length) break;

      const childIds = children.map((task) => task.id);
      taskIds.push(...childIds);
      frontierIds = childIds;
      level += 1;

      if (taskIds.length >= 1000) {
        truncated = true;
        break;
      }
    }

    if (frontierIds.length && level >= maxDepth) truncated = true;

    return {
      taskIds,
      maxDepthVisited: level,
      truncated,
    };
  }

  private async loadEventSummary(
    projectId: string,
    taskIds: string[],
    asOf: Date,
  ): Promise<{
    eventCountThroughAsOf: number;
    latestEventAtOrBefore: Date | null;
    firstEventAtOrBefore: Date | null;
  }> {
    const row = await this.taskActivityLogRepo
      .createQueryBuilder('log')
      .select('COUNT(log.id)', 'eventCount')
      .addSelect('MAX(log.createdAt)', 'latestEventAt')
      .addSelect('MIN(log.createdAt)', 'firstEventAt')
      .where('log.projectId = :projectId', { projectId })
      .andWhere('log.taskId IN (:...taskIds)', { taskIds })
      .andWhere('log.createdAt <= :asOf', { asOf })
      .getRawOne<{
        eventCount: string;
        latestEventAt: Date | null;
        firstEventAt: Date | null;
      }>();

    return {
      eventCountThroughAsOf: Number(row?.eventCount ?? 0),
      latestEventAtOrBefore: row?.latestEventAt ?? null,
      firstEventAtOrBefore: row?.firstEventAt ?? null,
    };
  }

  private toTimelineEvent(log: TaskActivityLog): TaskTimelineEvent {
    return {
      id: log.id,
      taskId: log.taskId,
      actionType: log.actionType,
      actionMeta: log.actionMeta,
      actorUser: log.actorUser
        ? {
            id: log.actorUser.id,
            firstName: log.actorUser.firstName,
            lastName: log.actorUser.lastName,
            email: log.actorUser.email,
          }
        : null,
      actorName: log.actorName,
      createdAt: log.createdAt,
    };
  }

  private parseRequiredDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return date;
  }

  private parseOptionalDate(
    value: string | undefined,
    field: string,
  ): Date | null {
    if (!value) return null;
    return this.parseRequiredDate(value, field);
  }
}
