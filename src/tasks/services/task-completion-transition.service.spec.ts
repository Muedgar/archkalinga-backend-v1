import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Task, TaskChecklistItem } from '../entities';
import {
  CompletionPolicy,
  ProjectStatus,
  StatusCategory,
} from '../project-config';
import { TaskCompletionTransitionService } from './task-completion-transition.service';
import { TaskCompletionMode } from '../types/task-completion-mode.type';

type FakeManagerState = {
  tasks: Task[];
  checklistItems: TaskChecklistItem[];
  saves: Array<{ target: unknown; value: unknown }>;
};

class FakeEntityManager {
  constructor(private readonly state: FakeManagerState) {}

  async find(target: unknown, options: any = {}) {
    if (target === Task) {
      return this.findTasks(options.where);
    }

    if (target === TaskChecklistItem) {
      return this.findChecklistItems(options.where);
    }

    return [];
  }

  async findOne(target: unknown, options: any = {}) {
    const rows = await this.find(target, options);
    return rows[0] ?? null;
  }

  async save(target: unknown, value: unknown) {
    this.state.saves.push({ target, value });
    return value;
  }

  private findTasks(where: any): Task[] {
    const filters = Array.isArray(where) ? where : [where];
    return this.state.tasks.filter((task) =>
      filters.some((filter) => {
        if (
          filter.projectId !== undefined &&
          task.projectId !== filter.projectId
        ) {
          return false;
        }
        if (
          filter.parentTaskId !== undefined &&
          task.parentTaskId !== filter.parentTaskId
        ) {
          return false;
        }
        if (filter.id !== undefined && task.id !== filter.id) {
          return false;
        }
        if (
          filter.completed !== undefined &&
          task.completed !== filter.completed
        ) {
          return false;
        }
        return true;
      }),
    );
  }

  private findChecklistItems(where: any): TaskChecklistItem[] {
    const filters = Array.isArray(where) ? where : [where];
    return this.state.checklistItems.filter((item) =>
      filters.some((filter) => {
        if (filter.taskId !== undefined && item.taskId !== filter.taskId) {
          return false;
        }
        if (
          filter.completed !== undefined &&
          item.completed !== filter.completed
        ) {
          return false;
        }
        return true;
      }),
    );
  }
}

const actor = {
  id: 'user-1',
  pkid: 1,
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
} as any;

function status(
  id: string,
  overrides: Partial<ProjectStatus> = {},
): ProjectStatus {
  return {
    id,
    projectId: 'project-1',
    name: id,
    key: id,
    color: '#10B981',
    orderIndex: 0,
    wipLimit: null,
    category: StatusCategory.ACTIVE,
    isDefault: false,
    isTerminal: false,
    isDone: false,
    completionPolicy: CompletionPolicy.NONE,
    isActive: true,
    ...overrides,
  } as ProjectStatus;
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    projectId: 'project-1',
    parentTaskId: null,
    statusId: 'active',
    status: status('active'),
    progress: 10,
    completed: false,
    completedAt: null,
    completedByUserId: null,
    completedByUser: null,
    deletedAt: null,
    ...overrides,
  } as Task;
}

function checklistItem(
  id: string,
  taskId: string,
  completed = false,
): TaskChecklistItem {
  return {
    id,
    taskId,
    text: `Checklist ${id}`,
    completed,
    completedAt: null,
    completedByUserId: null,
  } as TaskChecklistItem;
}

function manager(state: Partial<FakeManagerState> = {}) {
  const fullState: FakeManagerState = {
    tasks: state.tasks ?? [],
    checklistItems: state.checklistItems ?? [],
    saves: state.saves ?? [],
  };
  return {
    state: fullState,
    manager: new FakeEntityManager(fullState) as any,
  };
}

describe('TaskCompletionTransitionService', () => {
  const doneStatus = status('done', {
    category: StatusCategory.DONE,
    isTerminal: true,
    isDone: true,
    completionPolicy: CompletionPolicy.COMPLETE_OPEN_WORK_ITEMS,
  });

  it('marks only the task complete for complete_task_only', async () => {
    const service = new TaskCompletionTransitionService();
    const root = task('root');
    const item = checklistItem('item-1', 'root');
    const fake = manager({ checklistItems: [item] });

    const result = await service.applyTransition(fake.manager, {
      projectId: 'project-1',
      task: root,
      targetStatus: doneStatus,
      actorUser: actor,
      completionMode: TaskCompletionMode.TASK_ONLY,
    });

    expect(root.completed).toBe(true);
    expect(root.progress).toBe(100);
    expect(root.completedByUserId).toBe(actor.id);
    expect(item.completed).toBe(false);
    expect(result.effects).toEqual({
      checklistItemsCompleted: 0,
      descendantTasksCompleted: 0,
      rollupsRecalculated: true,
    });
    expect(result.changedTaskIds).toEqual(['root']);
  });

  it('rejects parent Done transitions while direct child tasks are open', async () => {
    const service = new TaskCompletionTransitionService();
    const root = task('root');
    const child = task('child', { parentTaskId: 'root' });
    const rootItem = checklistItem('item-root', 'root');
    const fake = manager({
      tasks: [child],
      checklistItems: [rootItem],
    });

    await expect(
      service.applyTransition(fake.manager, {
        projectId: 'project-1',
        task: root,
        targetStatus: doneStatus,
        actorUser: actor,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS',
        details: {
          openChecklistItemIds: [],
          openChildTaskIds: ['child'],
          openChecklistItems: [],
          openChildTasks: [
            {
              id: 'child',
              title: 'Task child',
              statusId: 'active',
              progress: 10,
            },
          ],
        },
      },
    });

    expect(root.completed).toBe(false);
    expect(child.completed).toBe(false);
    expect(rootItem.completed).toBe(false);
    expect(fake.state.saves).toHaveLength(0);
  });

  it('allows parent Done transitions once direct children are complete', async () => {
    const service = new TaskCompletionTransitionService();
    const root = task('root');
    const child = task('child', {
      parentTaskId: 'root',
      completed: true,
      progress: 100,
    });
    const rootItem = checklistItem('item-root', 'root');
    const fake = manager({
      tasks: [child],
      checklistItems: [rootItem],
    });

    const result = await service.applyTransition(fake.manager, {
      projectId: 'project-1',
      task: root,
      targetStatus: doneStatus,
      actorUser: actor,
    });

    expect(root.completed).toBe(true);
    expect(child.completed).toBe(true);
    expect(rootItem.completed).toBe(true);
    expect(result.effects.checklistItemsCompleted).toBe(1);
    expect(result.effects.descendantTasksCompleted).toBe(0);
    expect(result.changedTaskIds).toEqual(['root']);
  });

  it('rejects require_all_work_items_done when checklist or child tasks are open', async () => {
    const service = new TaskCompletionTransitionService();
    const root = task('root');
    const child = task('child', { parentTaskId: 'root' });
    const item = checklistItem('item-1', 'root');
    const fake = manager({ tasks: [child], checklistItems: [item] });
    const requireAllStatus = status('done', {
      category: StatusCategory.DONE,
      isTerminal: true,
      isDone: true,
      completionPolicy: CompletionPolicy.REQUIRE_ALL_WORK_ITEMS_DONE,
    });

    await expect(
      service.applyTransition(fake.manager, {
        projectId: 'project-1',
        task: root,
        targetStatus: requireAllStatus,
        actorUser: actor,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS',
        details: {
          openChecklistItemIds: ['item-1'],
          openChildTaskIds: ['child'],
          openChecklistItems: [
            {
              id: 'item-1',
              title: 'Checklist item-1',
              completed: false,
            },
          ],
          openChildTasks: [
            {
              id: 'child',
              title: 'Task child',
              statusId: 'active',
              progress: 10,
            },
          ],
        },
      },
    });
    expect(fake.state.saves).toHaveLength(0);
  });

  it('reopens a task leaving Done and preserves progress unless supplied', async () => {
    const service = new TaskCompletionTransitionService();
    const root = task('root', {
      statusId: 'done',
      status: doneStatus,
      completed: true,
      completedAt: new Date('2026-08-09T10:00:00.000Z'),
      completedByUserId: actor.id,
      progress: 100,
    });
    const fake = manager();

    await service.applyTransition(fake.manager, {
      projectId: 'project-1',
      task: root,
      targetStatus: status('active'),
      actorUser: actor,
    });

    expect(root.completed).toBe(false);
    expect(root.completedAt).toBeNull();
    expect(root.completedByUserId).toBeNull();
    expect(root.progress).toBe(100);
  });

  it('returns expanded blocker details when reopening would make a completed parent invalid', async () => {
    const service = new TaskCompletionTransitionService();
    const parent = task('parent', {
      statusId: 'done',
      status: doneStatus,
      completed: true,
      progress: 100,
    });
    const child = task('child', {
      parentTaskId: 'parent',
      statusId: 'done',
      status: doneStatus,
      completed: true,
      progress: 100,
    });
    const fake = manager({ tasks: [parent] });

    await expect(
      service.applyTransition(fake.manager, {
        projectId: 'project-1',
        task: child,
        targetStatus: status('active'),
        actorUser: actor,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS',
        details: {
          openChecklistItemIds: [],
          openChildTaskIds: ['child'],
          openChecklistItems: [],
          openChildTasks: [
            {
              id: 'child',
              title: 'Task child',
              statusId: 'done',
              progress: 100,
            },
          ],
        },
      },
    });
  });

  it('accepts explicit progress on non-Done transitions', async () => {
    const service = new TaskCompletionTransitionService();
    const root = task('root', { progress: 25 });
    const fake = manager();

    const result = await service.applyTransition(fake.manager, {
      projectId: 'project-1',
      task: root,
      targetStatus: status('active-2'),
      actorUser: actor,
      progress: 72,
    });

    expect(root.completed).toBe(false);
    expect(root.progress).toBe(72);
    expect(result.changedTaskIds).toEqual(['root']);
  });

  it('rejects completion modes against non-Done statuses', async () => {
    const service = new TaskCompletionTransitionService();
    const fake = manager();

    await expect(
      service.applyTransition(fake.manager, {
        projectId: 'project-1',
        task: task('root'),
        targetStatus: status('active'),
        actorUser: actor,
        completionMode: TaskCompletionMode.TASK_ONLY,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validates without mutating when validate_only has no open work', async () => {
    const service = new TaskCompletionTransitionService();
    const root = task('root');
    const fake = manager();

    const result = await service.applyTransition(fake.manager, {
      projectId: 'project-1',
      task: root,
      targetStatus: doneStatus,
      actorUser: actor,
      completionMode: TaskCompletionMode.VALIDATE_ONLY,
    });

    expect(root.completed).toBe(false);
    expect(root.progress).toBe(10);
    expect(result.changedTaskIds).toEqual([]);
    expect(fake.state.saves).toHaveLength(0);
  });
});
