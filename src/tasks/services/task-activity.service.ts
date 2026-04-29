import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxService } from 'src/outbox/outbox.service';
import { ProjectActivityLog } from 'src/projects/entities';
import { User } from 'src/users/entities';
import { TaskActivityLog, TaskActionType, Task } from '../entities';

@Injectable()
export class TaskActivityService {
  constructor(
    @InjectRepository(TaskActivityLog)
    private readonly taskActivityLogRepo: Repository<TaskActivityLog>,
    @InjectRepository(ProjectActivityLog)
    private readonly projectActivityLogRepo: Repository<ProjectActivityLog>,
    private readonly outboxService: OutboxService,
  ) {}

  // ── Map action enum → outbox event string ────────────────────────────────────

  static toEventType(action: TaskActionType): string {
    switch (action) {
      case TaskActionType.TASK_CREATED:    return 'task.created';
      case TaskActionType.TASK_UPDATED:    return 'task.updated';
      case TaskActionType.TASK_MOVED:      return 'task.moved';
      case TaskActionType.TASK_DELETED:    return 'task.deleted';
      case TaskActionType.TASK_ASSIGNED:   return 'task.assigned';
      case TaskActionType.TASK_UNASSIGNED: return 'task.unassigned';
      case TaskActionType.COMMENT_ADDED:   return 'task.comment.added';
      case TaskActionType.STATUS_CHANGED:  return 'task.status.changed';
      case TaskActionType.CHECKLIST_UPDATED: return 'task.checklist.updated';
      case TaskActionType.DEPENDENCY_ADDED:  return 'task.dependency.added';
      case TaskActionType.DEPENDENCY_REMOVED: return 'task.dependency.removed';
      default: return `task.${String(action).toLowerCase()}`;
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
      [actorUser.firstName, actorUser.lastName].filter(Boolean).join(' ') || actorUser.email;

    // Save both log rows concurrently (independent inserts — no FK between them)
    await Promise.all([
      manager.save(
        manager.create(TaskActivityLog, {
          taskId: task.id,
          actorUser,
          actorUserId: actorUser.id,
          actorName,
          actionType,
          actionMeta: actionMeta ?? {},
        }),
      ),
      manager.save(
        manager.create(ProjectActivityLog, {
          project: task.project,
          projectId: task.projectId,
          user: actorUser,
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

    const taskLogs: TaskActivityLog[]    = [];
    const projectLogs: ProjectActivityLog[] = [];

    for (const { task, actorUser, actionType, actionMeta } of entries) {
      const actorName =
        [actorUser.firstName, actorUser.lastName].filter(Boolean).join(' ') || actorUser.email;

      taskLogs.push(
        manager.create(TaskActivityLog, {
          taskId: task.id,
          actorUser,
          actorUserId: actorUser.id,
          actorName,
          actionType,
          actionMeta: actionMeta ?? {},
        }),
      );

      projectLogs.push(
        manager.create(ProjectActivityLog, {
          project: task.project,
          projectId: task.projectId,
          user: actorUser,
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
      actorUser: { id: string; firstName: string; lastName: string; email: string } | null;
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
}
