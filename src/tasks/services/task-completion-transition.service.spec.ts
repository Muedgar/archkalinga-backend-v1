import { TaskCompletionTransitionService } from './task-completion-transition.service';
import { TaskCompletionMode } from '../types/task-completion-mode.type';
describe('legacy task completion adapter', () => {
  const service = new TaskCompletionTransitionService();
  const manager = { save: jest.fn(async (_entity, task) => task) };
  beforeEach(() => manager.save.mockClear());
  it.each(Object.values(TaskCompletionMode))(
    'cannot complete with mode %s',
    async (completionMode) => {
      await expect(
        service.applyTransition(
          manager as any,
          {
            task: { statusId: 'todo', completed: false },
            targetStatus: { id: 'done', isDone: true },
            completionMode,
          } as any,
        ),
      ).rejects.toMatchObject({ response: { code: 'TASK_STATUS_IS_DERIVED' } });
      expect(manager.save).not.toHaveBeenCalled();
    },
  );
  it('cannot reopen Done', async () => {
    await expect(
      service.applyTransition(
        manager as any,
        {
          task: { statusId: 'done', completed: true },
          targetStatus: { id: 'todo', isDone: false },
        } as any,
      ),
    ).rejects.toThrow('TASK_STATUS_IS_DERIVED');
  });
  it('persists a non-workflow edit without completing descendants', async () => {
    const task = { statusId: 'todo', completed: false, progress: 10 };
    const result = await service.applyTransition(
      manager as any,
      {
        task,
        targetStatus: { id: 'todo', isDone: false },
        progress: 20,
      } as any,
    );
    expect(task.progress).toBe(20);
    expect(result.effects.checklistItemsCompleted).toBe(0);
    expect(manager.save).toHaveBeenCalledTimes(1);
  });
});
