import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { User } from 'src/users/entities';
import {
  Task,
  TaskActionType,
  TaskChecklistItem,
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
  ) {}

  async process(
    projectId: string,
    dto: TaskSyncEventsDto,
    actorUser: User,
  ): Promise<TaskSyncEventsResponse> {
    const clientEventIds = dto.events.map((event) =>
      event.clientEventId.trim(),
    );
    if (new Set(clientEventIds).size !== clientEventIds.length) {
      throw new BadRequestException(
        'Duplicate clientEventId values in the same sync request',
      );
    }

    const existing = await this.syncEventRepo.find({
      where: { projectId, clientEventId: In(clientEventIds) },
    });
    const existingMap = new Map(
      existing.map((event) => [event.clientEventId, event]),
    );

    const processed: TaskSyncEventResult[] = [];
    for (const event of dto.events) {
      const duplicate = existingMap.get(event.clientEventId);
      if (duplicate) {
        processed.push(this.toResult(duplicate, true));
        continue;
      }

      processed.push(await this.processOne(projectId, event, actorUser));
    }

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

      try {
        const task = await tx.findOne(Task, {
          where: { id: event.taskId, projectId, deletedAt: IsNull() },
          relations: ['project'],
        });
        if (!task) throw new BadRequestException(TASK_NOT_FOUND);
        linkedTaskId = task.id;
        syncEvent.task = task;
        syncEvent.taskId = task.id;

        const result = await this.applyEvent(tx, task, event, actorUser);
        syncEvent.result = result;
        const saved = await tx.save(TaskSyncEvent, syncEvent);
        return this.toResult(saved, false);
      } catch (error) {
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
        return this.applyChecklistToggle(tx, task, event, actorUser);
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

  private async applyChecklistToggle(
    tx: EntityManager,
    task: Task,
    event: TaskSyncEventDto,
    actorUser: User,
  ): Promise<Record<string, unknown>> {
    const checklistItemId = this.stringPayload(
      event.payload,
      'checklistItemId',
    );
    const completed = this.booleanPayload(event.payload, 'completed');
    const item = await tx.findOne(TaskChecklistItem, {
      where: { id: checklistItemId, taskId: task.id },
    });
    if (!item) throw new BadRequestException(INVALID_TASK_SYNC_EVENT);

    item.completed = completed;
    item.completedByUserId = completed ? actorUser.id : null;
    item.completedAt = completed ? new Date(event.occurredAt) : null;
    const saved = await tx.save(TaskChecklistItem, item);

    await this.activitySvc.log(
      tx,
      task,
      actorUser,
      TaskActionType.CHECKLIST_UPDATED,
      {
        operation: 'offline_checklist_item_toggled',
        checklistItemId: saved.id,
        completed: saved.completed,
        clientEventId: event.clientEventId,
      },
    );

    return { checklistItemId: saved.id, completed: saved.completed };
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
