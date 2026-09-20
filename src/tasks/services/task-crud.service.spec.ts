import { Task } from '../entities';
import {
  CompletionPolicy,
  ProjectStatus,
  StatusCategory,
} from '../project-config';
import { TaskCompletionMode } from '../types/task-completion-mode.type';
import { TaskCrudService } from './task-crud.service';

const requestUser = { id: 'user-1' } as any;
const actorUser = { id: 'user-1' } as any;

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

function serviceWithMocks(overrides: Record<string, any> = {}) {
  const manager = {
    transaction: jest.fn(async (callback: any) => callback(manager)),
    query: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };
  const taskRepo = {
    manager,
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
    ...overrides.taskRepo,
  };
  const authSvc = {
    verifyProjectPermission: jest.fn(),
    assertWipLimit: jest.fn(),
    assertTaskSubresourceMutationAllowed: jest.fn(),
    assertTaskOwnedChecklistManagementAllowed: jest.fn(),
    loadTasksForList: jest.fn(),
    ensureDateRange: jest.fn(),
    ...overrides.authSvc,
  };
  const userRepo = {
    findOneOrFail: jest.fn(),
    ...overrides.userRepo,
  };
  const projectStatusRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    ...overrides.projectStatusRepo,
  };
  const activitySvc = {
    log: jest.fn(),
    logBatch: jest.fn(),
    ...overrides.activitySvc,
  };
  const transitionSvc = {
    applyTransition: jest.fn(),
    ...overrides.transitionSvc,
  };
  const progressSvc = {
    recalculateProjectTaskProgress: jest.fn(),
    ...overrides.progressSvc,
  };

  const service = new TaskCrudService(
    taskRepo as any,
    {} as any,
    { count: jest.fn().mockResolvedValue(0) } as any,
    {} as any,
    userRepo as any,
    projectStatusRepo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    authSvc as any,
    {} as any,
    activitySvc as any,
    {} as any,
    {} as any,
    {} as any,
    progressSvc as any,
    {} as any,
    transitionSvc as any,
  );

  return {
    service,
    taskRepo,
    authSvc,
    userRepo,
    projectStatusRepo,
    activitySvc,
    progressSvc,
    transitionSvc,
  };
}

describe('TaskCrudService completion validation', () => {
  it.each(['moveTask', 'completeTask', 'reopenTask'] as const)(
    'rejects manual workflow through %s',
    async (method) => {
      const mocks = serviceWithMocks();
      await expect(
        (mocks.service[method] as any)(
          'project-1',
          'task-1',
          {},
          requestUser,
          jest.fn(),
        ),
      ).rejects.toMatchObject({ response: { code: 'TASK_STATUS_IS_DERIVED' } });
      expect(mocks.taskRepo.manager.transaction).not.toHaveBeenCalled();
    },
  );

  it('returns partial outcomes for bulk updates', async () => {
    const activeStatus = status('active');
    const leaf = task('leaf', { status: activeStatus, progress: 10 });
    const parent = task('parent', { status: activeStatus, progress: 40 });
    const returnedTask = { id: leaf.id, progress: 55 } as any;
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([{ parentTaskId: parent.id, childCount: '2' }]),
    };
    const mocks = serviceWithMocks();
    mocks.authSvc.verifyProjectPermission.mockResolvedValue({
      membership: { id: 'membership-1' },
    });
    mocks.authSvc.loadTasksForList.mockResolvedValue([returnedTask]);
    mocks.userRepo.findOneOrFail.mockResolvedValue(actorUser);
    mocks.taskRepo.find.mockResolvedValue([leaf, parent]);
    mocks.taskRepo.createQueryBuilder.mockReturnValue(queryBuilder);
    mocks.projectStatusRepo.find.mockResolvedValue([]);
    mocks.taskRepo.manager.findOne.mockImplementation(
      async (_target, options) => {
        const id = options.where.id;
        if (id === leaf.id) return leaf;
        if (id === parent.id) return parent;
        return null;
      },
    );
    mocks.transitionSvc.applyTransition.mockImplementation(
      async (_tx, input) => {
        input.task.progress = input.progress;
        return {
          task: input.task,
          effects: {
            checklistItemsCompleted: 0,
            descendantTasksCompleted: 0,
            rollupsRecalculated: true,
          },
          changedTaskIds: [input.task.id],
          warnings: [],
          policy: CompletionPolicy.NONE,
          completionMode: TaskCompletionMode.APPLY_STATUS_POLICY,
        };
      },
    );

    await expect(
      mocks.service.bulkUpdateTasks(
        'project-1',
        {
          items: [
            { taskId: leaf.id, progress: 55 },
            { taskId: parent.id, progress: 80 },
            { taskId: 'missing-task-id', progress: 10 },
          ],
        } as any,
        requestUser,
      ),
    ).resolves.toEqual({
      tasks: [returnedTask],
      succeeded: [leaf.id],
      failed: [
        {
          taskId: parent.id,
          code: 'BadRequestException',
          message:
            'Parent task progress is automatically derived from subtasks',
        },
        {
          taskId: 'missing-task-id',
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
        },
      ],
      changedTaskIds: [leaf.id],
    });

    expect(mocks.taskRepo.manager.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.authSvc.loadTasksForList).toHaveBeenCalledWith(
      [leaf.id],
      'project-1',
    );
  });
});
