import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { User } from 'src/users/entities';
import { Task, TaskChecklistItem } from '../entities';
import {
  CompletionPolicy,
  ProjectStatus,
} from '../project-config/project-status.entity';
import {
  INVALID_DONE_STATUS,
  TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS,
} from '../messages';
import { TaskCompletionMode } from '../types/task-completion-mode.type';

export type TaskTransitionEffects = {
  checklistItemsCompleted: number;
  descendantTasksCompleted: number;
  rollupsRecalculated: boolean;
};

export type TaskTransitionResult = {
  task: Task;
  effects: TaskTransitionEffects;
  changedTaskIds: string[];
  warnings: string[];
  policy: CompletionPolicy;
  completionMode: TaskCompletionMode;
};

export type TaskTransitionInput = {
  projectId: string;
  task: Task;
  targetStatus: ProjectStatus;
  actorUser: User;
  completionMode?: TaskCompletionMode;
  progress?: number | null;
  reason?: string | null;
};

type OpenWorkItems = {
  checklistItemIds: string[];
  childTaskIds: string[];
  checklistItems: Array<{
    id: string;
    title: string;
    completed: boolean;
  }>;
  childTasks: Array<{
    id: string;
    title: string;
    statusId: string | null;
    progress: number | null;
  }>;
};

@Injectable()
export class TaskCompletionTransitionService {
  async applyTransition(
    manager: EntityManager,
    input: TaskTransitionInput,
  ): Promise<TaskTransitionResult> {
    const completionMode =
      input.completionMode ?? TaskCompletionMode.APPLY_STATUS_POLICY;
    const effectivePolicy = this.resolvePolicy(
      input.targetStatus,
      completionMode,
    );
    const changedTaskIds = new Set<string>();
    const effects: TaskTransitionEffects = {
      checklistItemsCompleted: 0,
      descendantTasksCompleted: 0,
      rollupsRecalculated: false,
    };
    const previousStatusId = input.task.statusId;
    const previousProgress = input.task.progress;
    const wasDone = input.task.status?.isDone === true || input.task.completed;
    const enteringDone = input.targetStatus.isDone === true && !wasDone;
    const leavingDone = input.targetStatus.isDone !== true && wasDone;
    const now = new Date();

    if (
      input.targetStatus.isDone !== true &&
      completionMode !== TaskCompletionMode.APPLY_STATUS_POLICY
    ) {
      throw new UnprocessableEntityException({
        message: INVALID_DONE_STATUS,
        code: 'INVALID_DONE_STATUS',
        details: { statusId: input.targetStatus.id },
      });
    }

    if (
      input.targetStatus.isDone === true &&
      (effectivePolicy === CompletionPolicy.REQUIRE_ALL_WORK_ITEMS_DONE ||
        completionMode === TaskCompletionMode.VALIDATE_ONLY)
    ) {
      const openWorkItems = await this.loadOpenWorkItems(manager, input.task);
      if (
        openWorkItems.checklistItemIds.length > 0 ||
        openWorkItems.childTaskIds.length > 0
      ) {
        throw this.createDoneBlockedException(openWorkItems);
      }
    }

    if (
      input.targetStatus.isDone === true &&
      effectivePolicy !== CompletionPolicy.REQUIRE_ALL_WORK_ITEMS_DONE &&
      completionMode !== TaskCompletionMode.VALIDATE_ONLY
    ) {
      const openChildTaskIds = await this.loadOpenChildTaskIds(
        manager,
        input.task,
      );
      if (openChildTaskIds.length > 0) {
        throw this.createDoneBlockedException({
          checklistItemIds: [],
          childTaskIds: openChildTaskIds.map((child) => child.id),
          checklistItems: [],
          childTasks: openChildTaskIds,
        });
      }
    }

    if (leavingDone && input.task.parentTaskId) {
      const parentTask = await manager.findOne(Task, {
        where: {
          projectId: input.projectId,
          id: input.task.parentTaskId,
          deletedAt: IsNull(),
        },
        select: ['id', 'completed'],
      });
      if (parentTask?.completed) {
        throw this.createDoneBlockedException({
          checklistItemIds: [],
          childTaskIds: [input.task.id],
          checklistItems: [],
          childTasks: [this.toOpenChildTask(input.task)],
        });
      }
    }

    if (completionMode === TaskCompletionMode.VALIDATE_ONLY) {
      return {
        task: input.task,
        effects,
        changedTaskIds: [],
        warnings: [],
        policy: effectivePolicy,
        completionMode,
      };
    }

    input.task.status = input.targetStatus;
    input.task.statusId = input.targetStatus.id;

    if (input.targetStatus.isDone === true) {
      this.markTaskComplete(input.task, input.actorUser, now);
    } else if (leavingDone) {
      input.task.completed = false;
      input.task.completedAt = null;
      input.task.completedByUser = null;
      input.task.completedByUserId = null;
      if (input.progress !== undefined) {
        input.task.progress = input.progress;
      }
    } else if (input.progress !== undefined) {
      input.task.progress = input.progress;
    }

    await manager.save(Task, input.task);
    changedTaskIds.add(input.task.id);

    if (input.targetStatus.isDone === true && enteringDone) {
      if (
        effectivePolicy === CompletionPolicy.COMPLETE_OPEN_WORK_ITEMS ||
        completionMode === TaskCompletionMode.TASK_AND_CHECKLIST ||
        completionMode === TaskCompletionMode.TASK_CHECKLIST_AND_DESCENDANTS
      ) {
        effects.checklistItemsCompleted = await this.completeChecklistItems(
          manager,
          [input.task.id],
          input.actorUser,
          now,
        );
      }
    }

    effects.rollupsRecalculated =
      changedTaskIds.size > 1 ||
      previousStatusId !== input.targetStatus.id ||
      previousProgress !== input.task.progress;

    return {
      task: input.task,
      effects,
      changedTaskIds: [...changedTaskIds],
      warnings: [],
      policy: effectivePolicy,
      completionMode,
    };
  }

  private resolvePolicy(
    targetStatus: ProjectStatus,
    completionMode: TaskCompletionMode,
  ): CompletionPolicy {
    if (completionMode === TaskCompletionMode.APPLY_STATUS_POLICY) {
      return targetStatus.completionPolicy ?? CompletionPolicy.NONE;
    }
    if (completionMode === TaskCompletionMode.TASK_ONLY) {
      return CompletionPolicy.COMPLETE_TASK_ONLY;
    }
    if (completionMode === TaskCompletionMode.VALIDATE_ONLY) {
      return CompletionPolicy.REQUIRE_ALL_WORK_ITEMS_DONE;
    }
    return CompletionPolicy.COMPLETE_OPEN_WORK_ITEMS;
  }

  private markTaskComplete(
    task: Task,
    actorUser: User,
    completedAt: Date,
  ): void {
    task.completed = true;
    task.completedAt = completedAt;
    task.completedByUser = actorUser;
    task.completedByUserId = actorUser.id;
    task.progress = 100;
  }

  private async loadOpenWorkItems(
    manager: EntityManager,
    task: Task,
  ): Promise<OpenWorkItems> {
    const [openChecklistItems, openChildTasks] = await Promise.all([
      manager.find(TaskChecklistItem, {
        where: { taskId: task.id, completed: false },
        select: ['id', 'text', 'completed'],
      }),
      manager.find(Task, {
        where: {
          projectId: task.projectId,
          parentTaskId: task.id,
          completed: false,
          deletedAt: IsNull(),
        },
        select: ['id', 'title', 'statusId', 'progress'],
      }),
    ]);

    return {
      checklistItemIds: openChecklistItems.map((item) => item.id),
      childTaskIds: openChildTasks.map((child) => child.id),
      checklistItems: openChecklistItems.map((item) => ({
        id: item.id,
        title: item.text,
        completed: item.completed,
      })),
      childTasks: openChildTasks.map((child) => this.toOpenChildTask(child)),
    };
  }

  private async loadOpenChildTaskIds(
    manager: EntityManager,
    task: Task,
  ): Promise<OpenWorkItems['childTasks']> {
    const openChildTasks = await manager.find(Task, {
      where: {
        projectId: task.projectId,
        parentTaskId: task.id,
        completed: false,
        deletedAt: IsNull(),
      },
      select: ['id', 'title', 'statusId', 'progress'],
    });

    return openChildTasks.map((child) => this.toOpenChildTask(child));
  }

  private toOpenChildTask(
    task: Pick<Task, 'id' | 'title' | 'statusId' | 'progress'>,
  ): OpenWorkItems['childTasks'][number] {
    return {
      id: task.id,
      title: task.title ?? '',
      statusId: task.statusId ?? null,
      progress: task.progress ?? null,
    };
  }

  private createDoneBlockedException(
    openWorkItems: OpenWorkItems,
  ): ConflictException {
    return new ConflictException({
      message: TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS,
      code: 'TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS',
      details: {
        openChecklistItemIds: openWorkItems.checklistItemIds,
        openChildTaskIds: openWorkItems.childTaskIds,
        openChecklistItems: openWorkItems.checklistItems,
        openChildTasks: openWorkItems.childTasks,
      },
    });
  }

  private async completeChecklistItems(
    manager: EntityManager,
    taskIds: string[],
    actorUser: User,
    completedAt: Date,
  ): Promise<number> {
    if (taskIds.length === 0) return 0;

    const items = await manager.find(TaskChecklistItem, {
      where: taskIds.map((taskId) => ({ taskId, completed: false })),
    });

    for (const item of items) {
      item.completed = true;
      item.completedAt = completedAt;
      item.completedByUserId = actorUser.id;
    }

    if (items.length > 0) {
      await manager.save(TaskChecklistItem, items);
    }

    return items.length;
  }
}
