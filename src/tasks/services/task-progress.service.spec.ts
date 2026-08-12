import { Task } from '../entities';
import { TaskProgressService } from './task-progress.service';

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    completed: false,
    progress: 0,
    ...overrides,
  } as Task;
}

describe('TaskProgressService', () => {
  const service = new TaskProgressService(null as any, null as any);

  it('uses explicit progress for leaf tasks', () => {
    const leaf = task('leaf', { progress: 45 });

    expect(service.calculateTaskProgress(leaf, new Map(), new Map())).toBe(45);
  });

  it('treats completed leaf tasks as 100 percent complete', () => {
    const leaf = task('leaf', { completed: true, progress: 20 });

    expect(service.calculateTaskProgress(leaf, new Map(), new Map())).toBe(100);
  });

  it('aggregates parent progress from direct child task progress', () => {
    const parent = task('parent', { completed: true, progress: 100 });
    const children = [task('child-1'), task('child-2')];

    expect(
      service.calculateTaskProgress(
        parent,
        new Map([[parent.id, children]]),
        new Map([
          ['child-1', 20],
          ['child-2', 80],
        ]),
      ),
    ).toBe(50);
  });

  it('does not sync branched checklist items during task progress recalculation', async () => {
    const manager = {
      find: jest.fn().mockResolvedValue([
        task('parent', {
          projectId: 'project-1',
          parentTaskId: null,
          progress: 50,
        }),
      ]),
      save: jest.fn(),
    };

    await service.recalculateProjectTaskProgress(manager as any, 'project-1');

    expect(manager.find).toHaveBeenCalledTimes(1);
    expect(manager.find).toHaveBeenCalledWith(Task, expect.any(Object));
    expect(manager.save).not.toHaveBeenCalled();
  });
});
