import { isDeepStrictEqual } from 'node:util';
import { TaskAuthService } from './task-auth.service';
import { ForbiddenException } from '@nestjs/common';
import { conflict, lockWorkflow } from '../workflow/workflow-domain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { User } from 'src/users/entities';
import {
  Task,
  TaskActionType,
  TaskComment,
  TaskLocation,
  TaskLocationProgress,
  TaskSyncEvent,
  TaskSyncEventStatus,
  TaskSyncEventType,
} from '../entities';
import { TaskSyncEventDto, TaskSyncEventsDto } from '../dtos';
import { INVALID_TASK_SYNC_EVENT, TASK_NOT_FOUND } from '../messages';
import { TaskActivityService } from './task-activity.service';
import { TaskProgressService } from './task-progress.service';

type TaskSyncEventResult = {
  clientEventId: string;
  eventId: string;
  status: TaskSyncEventStatus;
  duplicate: boolean;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
};

export type TaskSyncEventsResponse = {
  processed: TaskSyncEventResult[];
  summary: {
    received: number;
    applied: number;
    duplicate: number;
    failed: number;
  };
};

@Injectable()
export class TaskSyncEventsService {
  constructor(
    @InjectRepository(TaskSyncEvent)
    private readonly syncEventRepo: Repository<TaskSyncEvent>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly activitySvc: TaskActivityService,
    private readonly progressSvc: TaskProgressService,
    private readonly authSvc: TaskAuthService,
  ) {}

  async process(
    projectId: string,
    dto: TaskSyncEventsDto,
    actorUser: User,
  ): Promise<TaskSyncEventsResponse> {
    if (
      dto.events.some(
        (e) => e.type === TaskSyncEventType.CHECKLIST_ITEM_TOGGLED,
      )
    )
      conflict('WORKFLOW_COMMAND_REQUIRED');
    const clientEventIds = dto.events.map((event) =>
      event.clientEventId.trim(),
    );
    if (new Set(clientEventIds).size !== clientEventIds.length) {
      throw new BadRequestException(
        'Duplicate clientEventId values in the same sync request',
      );
    }

    const processed: TaskSyncEventResult[] = [];
    for (const event of dto.events)
      processed.push(await this.processOne(projectId, event, actorUser));

    return {
      processed,
      summary: {
        received: dto.events.length,
        applied: processed.filter(
          (event) =>
            event.status === TaskSyncEventStatus.APPLIED && !event.duplicate,
        ).length,
        duplicate: processed.filter((event) => event.duplicate).length,
        failed: processed.filter(
          (event) => event.status === TaskSyncEventStatus.FAILED,
        ).length,
      },
    };
  }

  private async processOne(
    projectId: string,
    event: TaskSyncEventDto,
    actorUser: User,
  ): Promise<TaskSyncEventResult> {
    return this.syncEventRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, projectId);
      await this.authSvc.verifyProjectPermission(projectId, actorUser, 'view');
      const existing = await tx.findOne(TaskSyncEvent, {
        where: { projectId, clientEventId: event.clientEventId.trim() },
      });
      if (existing) {
        if (
          existing.actorUserId !== actorUser.id ||
          existing.taskId !== event.taskId ||
          existing.type !== event.type ||
          !isDeepStrictEqual(existing.payload, event.payload)
        )
          conflict('IDEMPOTENCY_KEY_REUSED');
        const owner = await tx.findOne(Task, {
          where: { id: event.taskId, projectId, deletedAt: IsNull() },
          relations: ['assignees'],
        });
        if (!owner || !(await this.authSvc.canViewTask(owner, actorUser)))
          throw new ForbiddenException('TASK_ACTION_FORBIDDEN');
        return this.toResult(existing, true);
      }
      const syncEvent = tx.create(TaskSyncEvent, {
        projectId,
        taskId: null,
        clientEventId: event.clientEventId.trim(),
        type: event.type,
        status: TaskSyncEventStatus.APPLIED,
        actorUser,
        actorUserId: actorUser.id,
        occurredAt: new Date(event.occurredAt),
        payload: event.payload,
        result: null,
        errorMessage: null,
      });
      let linkedTaskId: string | null = null;

      await tx.query('SAVEPOINT sync_event_mutation');
      try {
        const task = await tx.findOne(Task, {
          where: { id: event.taskId, projectId, deletedAt: IsNull() },
          relations: ['project', 'assignees'],
        });
        if (!task) throw new BadRequestException(TASK_NOT_FOUND);
        if (!(await this.authSvc.canViewTask(task, actorUser)))
          throw new ForbiddenException('TASK_ACTION_FORBIDDEN');
        if (
          !task.assignees.some((a) => a.userId === actorUser.id) &&
          !(await this.authSvc.canManageTaskOwnedChecklist(
            projectId,
            task.id,
            actorUser.id,
          ))
        )
          throw new ForbiddenException('TASK_ACTION_FORBIDDEN');
        linkedTaskId = task.id;
        syncEvent.task = task;
        syncEvent.taskId = task.id;

        const result = await this.applyEvent(tx, task, event, actorUser);
        syncEvent.result = result;
        const saved = await tx.save(TaskSyncEvent, syncEvent);
        return this.toResult(saved, false);
      } catch (error) {
        await tx.query('ROLLBACK TO SAVEPOINT sync_event_mutation');
        syncEvent.status = TaskSyncEventStatus.FAILED;
        syncEvent.taskId = linkedTaskId;
        syncEvent.errorMessage =
          error instanceof Error ? error.message : INVALID_TASK_SYNC_EVENT;
        const saved = await tx.save(TaskSyncEvent, syncEvent);
        return this.toResult(saved, false);
      }
    });
  }

  private async applyEvent(
    tx: EntityManager,
    task: Task,
    event: TaskSyncEventDto,
    actorUser: User,
  ): Promise<Record<string, unknown>> {
    switch (event.type) {
      case TaskSyncEventType.CHECKLIST_ITEM_TOGGLED:
        return conflict('WORKFLOW_COMMAND_REQUIRED');
      case TaskSyncEventType.TASK_PROGRESS_UPDATED:
        return this.applyTaskProgress(tx, task, event, actorUser);
      case TaskSyncEventType.SITE_NOTE_ADDED:
        return this.applySiteNote(tx, task, event, actorUser);
      case TaskSyncEventType.LOCATION_PROGRESS_UPDATED:
        return this.applyLocationProgress(tx, task, event, actorUser);
      default:
        throw new BadRequestException(INVALID_TASK_SYNC_EVENT);
    }
  }

  private async applyTaskProgress(
    tx: EntityManager,
    task: Task,
    event: TaskSyncEventDto,
    actorUser: User,
  ): Promise<Record<string, unknown>> {
    const progress = this.optionalNumberPayload(event.payload, 'progress');
    if (
      progress === undefined ||
      progress === null ||
      !Number.isInteger(progress) ||
      progress < 0 ||
      progress > 100
    ) {
      throw new BadRequestException(INVALID_TASK_SYNC_EVENT);
    }

    const childCount = await tx.count(Task, {
      where: {
        projectId: task.projectId,
        parentTaskId: task.id,
        deletedAt: IsNull(),
      },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        'Parent task progress is automatically derived from subtasks',
      );
    }
    if (task.completed && progress !== 100) {
      throw new BadRequestException(
        'Completed leaf tasks must keep progress at 100',
      );
    }

    const previousProgress = task.progress;
    task.progress = progress;
    await tx.save(Task, task);
    await this.progressSvc.recalculateProjectTaskProgress(tx, task.projectId);

    await this.activitySvc.log(
      tx,
      task,
      actorUser,
      TaskActionType.TASK_PROGRESS_CHANGED,
      {
        previousProgress,
        nextProgress: progress,
        source: 'offline_sync',
        clientEventId: event.clientEventId,
      },
    );

    return { previousProgress, nextProgress: progress };
  }

  private async applySiteNote(
    tx: EntityManager,
    task: Task,
    event: TaskSyncEventDto,
    actorUser: User,
  ): Promise<Record<string, unknown>> {
    const body =
      this.optionalStringPayload(event.payload, 'body') ??
      this.optionalStringPayload(event.payload, 'siteNote');
    if (!body) throw new BadRequestException(INVALID_TASK_SYNC_EVENT);

    const locationId = this.optionalStringPayload(event.payload, 'locationId');
    if (locationId) {
      const location = await tx.findOne(TaskLocation, {
        where: { id: locationId, taskId: task.id, isActive: true },
      });
      if (!location) throw new BadRequestException(INVALID_TASK_SYNC_EVENT);
    }

    const comment = await tx.save(
      tx.create(TaskComment, {
        task,
        taskId: task.id,
        authorUser: actorUser,
        authorUserId: actorUser.id,
        body: locationId
          ? `[Location ${locationId}] ${body.trim()}`
          : body.trim(),
        parentCommentId: null,
        deletedAt: null,
      }),
    );

    await this.activitySvc.log(
      tx,
      task,
      actorUser,
      TaskActionType.COMMENT_ADDED,
      {
        operation: 'offline_site_note_added',
        commentId: comment.id,
        locationId,
        clientEventId: event.clientEventId,
      },
    );

    return { commentId: comment.id, locationId: locationId ?? null };
  }

  private async applyLocationProgress(
    tx: EntityManager,
    task: Task,
    event: TaskSyncEventDto,
    actorUser: User,
  ): Promise<Record<string, unknown>> {
    const locationId = this.stringPayload(event.payload, 'locationId');
    const location = await tx.findOne(TaskLocation, {
      where: { id: locationId, taskId: task.id, isActive: true },
    });
    if (!location) throw new BadRequestException(INVALID_TASK_SYNC_EVENT);

    const progress =
      (await tx.findOne(TaskLocationProgress, {
        where: { taskLocationId: location.id },
      })) ??
      tx.create(TaskLocationProgress, {
        location,
        taskLocationId: location.id,
        progress: null,
        completed: false,
        status: null,
        actualQuantity: null,
        siteNote: null,
        updatedByUserId: null,
        reportedAt: null,
      });

    const nextProgress = this.optionalNumberPayload(event.payload, 'progress');
    const nextCompleted = this.optionalBooleanPayload(
      event.payload,
      'completed',
    );
    const nextStatus = this.optionalStringPayload(event.payload, 'status');
    const actualQuantity = this.optionalNumberPayload(
      event.payload,
      'actualQuantity',
    );
    const siteNote = this.optionalStringPayload(event.payload, 'siteNote');

    if (nextProgress !== undefined) {
      if (nextProgress !== null && (nextProgress < 0 || nextProgress > 100)) {
        throw new BadRequestException(INVALID_TASK_SYNC_EVENT);
      }
      progress.progress = nextProgress;
    }
    if (nextCompleted !== undefined) progress.completed = nextCompleted;
    if (nextStatus !== undefined) progress.status = nextStatus;
    if (actualQuantity !== undefined) progress.actualQuantity = actualQuantity;
    if (siteNote !== undefined) progress.siteNote = siteNote;
    progress.updatedByUser = actorUser;
    progress.updatedByUserId = actorUser.id;
    progress.reportedAt = new Date(event.occurredAt);

    const saved = await tx.save(TaskLocationProgress, progress);

    await this.activitySvc.log(
      tx,
      task,
      actorUser,
      TaskActionType.TASK_UPDATED,
      {
        operation: 'offline_location_progress_updated',
        locationId: location.id,
        progress: saved.progress,
        completed: saved.completed,
        status: saved.status,
        clientEventId: event.clientEventId,
      },
    );

    return {
      locationId: location.id,
      progressId: saved.id,
      progress: saved.progress,
      completed: saved.completed,
      status: saved.status,
    };
  }

  private stringPayload(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(INVALID_TASK_SYNC_EVENT);
    }
    return value.trim();
  }

  private optionalStringPayload(
    payload: Record<string, unknown>,
    key: string,
  ): string | null | undefined {
    if (!(key in payload)) return undefined;
    const value = payload[key];
    if (value === null) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException(INVALID_TASK_SYNC_EVENT);
    }
    return value.trim() || null;
  }

  private booleanPayload(
    payload: Record<string, unknown>,
    key: string,
  ): boolean {
    const value = payload[key];
    if (typeof value !== 'boolean') {
      throw new BadRequestException(INVALID_TASK_SYNC_EVENT);
    }
    return value;
  }

  private optionalBooleanPayload(
    payload: Record<string, unknown>,
    key: string,
  ): boolean | undefined {
    if (!(key in payload)) return undefined;
    return this.booleanPayload(payload, key);
  }

  private optionalNumberPayload(
    payload: Record<string, unknown>,
    key: string,
  ): number | null | undefined {
    if (!(key in payload)) return undefined;
    const value = payload[key];
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(INVALID_TASK_SYNC_EVENT);
    }
    return value;
  }

  private toResult(
    event: TaskSyncEvent,
    duplicate: boolean,
  ): TaskSyncEventResult {
    return {
      clientEventId: event.clientEventId,
      eventId: event.id,
      status: event.status,
      duplicate,
      result: event.result,
      errorMessage: event.errorMessage,
    };
  }
}
