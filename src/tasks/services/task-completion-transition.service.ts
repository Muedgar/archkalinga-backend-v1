import { conflict } from '../workflow/workflow-domain';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { User } from 'src/users/entities';
import { Task } from '../entities';
import {
  CompletionPolicy,
  ProjectStatus,
} from '../project-config/project-status.entity';
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

@Injectable()
export class TaskCompletionTransitionService {
  async applyTransition(
    manager: EntityManager,
    input: TaskTransitionInput,
  ): Promise<TaskTransitionResult> {
    if (
      input.targetStatus.id !== input.task.statusId ||
      Boolean(input.targetStatus.isDone) !== input.task.completed
    )
      conflict('TASK_STATUS_IS_DERIVED');
    if (input.progress !== undefined) input.task.progress = input.progress;
    await manager.save(Task, input.task);
    return {
      task: input.task,
      effects: {
        checklistItemsCompleted: 0,
        descendantTasksCompleted: 0,
        rollupsRecalculated: false,
      },
      changedTaskIds: [],
      warnings: [],
      policy: CompletionPolicy.NONE,
      completionMode: TaskCompletionMode.APPLY_STATUS_POLICY,
    };
  }
}
