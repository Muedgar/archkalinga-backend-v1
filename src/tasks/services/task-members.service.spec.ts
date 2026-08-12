import { Task } from '../entities';
import { TaskMembersService } from './task-members.service';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    completed: false,
    assignees: [],
    checklistItems: [],
    comments: [],
    dependencyEdges: [],
    reporteeUser: null,
    ...overrides,
  } as Task;
}

describe('TaskMembersService progress edit hints', () => {
  const service = new TaskMembersService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );

  it('allows leaf progress edits when the caller can update tasks', () => {
    const model = service.buildTaskReadModel(task(), new Map(), {
      childCount: 0,
      commentCount: 0,
      canUpdateTask: true,
    });

    expect(model.canEditProgress).toBe(true);
    expect(model.progressEditBlockedReason).toBeNull();
  });

  it('blocks parent progress edits', () => {
    const model = service.buildTaskReadModel(task(), new Map(), {
      childCount: 2,
      commentCount: 0,
      canUpdateTask: true,
    });

    expect(model.canEditProgress).toBe(false);
    expect(model.progressEditBlockedReason).toBe('HAS_CHILDREN');
  });

  it('blocks completed leaf progress edits', () => {
    const model = service.buildTaskReadModel(
      task({ completed: true }),
      new Map(),
      {
        childCount: 0,
        commentCount: 0,
        canUpdateTask: true,
      },
    );

    expect(model.canEditProgress).toBe(false);
    expect(model.progressEditBlockedReason).toBe('COMPLETED');
  });

  it('blocks progress edits when the caller cannot update tasks', () => {
    const model = service.buildTaskReadModel(task(), new Map(), {
      childCount: 0,
      commentCount: 0,
      canUpdateTask: false,
    });

    expect(model.canEditProgress).toBe(false);
    expect(model.progressEditBlockedReason).toBe('FORBIDDEN');
  });
});
