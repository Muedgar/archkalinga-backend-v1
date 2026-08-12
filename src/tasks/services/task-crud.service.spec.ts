import { Task } from '../entities';
import {
  CompletionPolicy,
  ProjectStatus,
  StatusCategory,
} from '../project-config';
import { TaskCompletionMode } from '../types/task-completion-mode.type';
import { TaskCrudService } from './task-crud.service';
import { ConflictException } from '@nestjs/common';

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
    {} as any,
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
  it('returns a side-effect-free validate_only response', async () => {
    const root = task('root');
    const doneStatus = status('done', {
      category: StatusCategory.DONE,
      isTerminal: true,
      isDone: true,
      completionPolicy: CompletionPolicy.COMPLETE_OPEN_WORK_ITEMS,
    });
    const transitionResult = {
      task: root,
      effects: {
        checklistItemsCompleted: 0,
        descendantTasksCompleted: 0,
        rollupsRecalculated: false,
      },
      changedTaskIds: [],
      warnings: [],
      policy: CompletionPolicy.REQUIRE_ALL_WORK_ITEMS_DONE,
      completionMode: TaskCompletionMode.VALIDATE_ONLY,
    };
    const mocks = serviceWithMocks();
    mocks.authSvc.verifyProjectPermission.mockResolvedValue({
      membership: { id: 'membership-1' },
    });
    mocks.taskRepo.findOne.mockResolvedValue(root);
    mocks.userRepo.findOneOrFail.mockResolvedValue(actorUser);
    mocks.projectStatusRepo.findOne.mockResolvedValue(doneStatus);
    mocks.transitionSvc.applyTransition.mockResolvedValue(transitionResult);

    const getTask = jest.fn();

    await expect(
      mocks.service.completeTask(
        'project-1',
        root.id,
        {
          statusId: doneStatus.id,
          completionMode: TaskCompletionMode.VALIDATE_ONLY,
        },
        requestUser,
        getTask,
      ),
    ).resolves.toEqual({
      allowed: true,
      taskId: root.id,
      statusId: doneStatus.id,
      effects: transitionResult.effects,
      changedTaskIds: [],
      warnings: [],
    });

    expect(mocks.transitionSvc.applyTransition).toHaveBeenCalledWith(
      mocks.taskRepo.manager,
      expect.objectContaining({
        projectId: 'project-1',
        task: root,
        targetStatus: doneStatus,
        actorUser,
        completionMode: TaskCompletionMode.VALIDATE_ONLY,
      }),
    );
    expect(mocks.activitySvc.log).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
  });

  it('reopens a completed task into a non-Done status', async () => {
    const doneStatus = status('done', {
      category: StatusCategory.DONE,
      isTerminal: true,
      isDone: true,
      completionPolicy: CompletionPolicy.COMPLETE_OPEN_WORK_ITEMS,
    });
    const activeStatus = status('active-2');
    const root = task('root', {
      statusId: doneStatus.id,
      status: doneStatus,
      completed: true,
      progress: 100,
    });
    const transitionResult = {
      task: root,
      effects: {
        checklistItemsCompleted: 0,
        descendantTasksCompleted: 0,
        rollupsRecalculated: true,
      },
      changedTaskIds: [root.id],
      warnings: [],
      policy: CompletionPolicy.NONE,
      completionMode: TaskCompletionMode.APPLY_STATUS_POLICY,
    };
    const reopenedTask = { id: root.id, progress: 75 } as any;
    const mocks = serviceWithMocks();
    mocks.authSvc.verifyProjectPermission.mockResolvedValue({
      membership: { id: 'membership-1' },
    });
    mocks.taskRepo.findOne.mockResolvedValue(root);
    mocks.taskRepo.count.mockResolvedValue(0);
    mocks.userRepo.findOneOrFail.mockResolvedValue(actorUser);
    mocks.projectStatusRepo.findOne.mockResolvedValue(activeStatus);
    mocks.transitionSvc.applyTransition.mockResolvedValue(transitionResult);
    const getTask = jest.fn().mockResolvedValue(reopenedTask);

    await expect(
      mocks.service.reopenTask(
        'project-1',
        root.id,
        {
          statusId: activeStatus.id,
          progress: 75,
          reason: 'More work needed',
        },
        requestUser,
        getTask,
      ),
    ).resolves.toEqual({
      task: reopenedTask,
      audit: {
        previousStatusId: doneStatus.id,
        nextStatusId: activeStatus.id,
        previousProgress: 100,
        nextProgress: 75,
        reason: 'More work needed',
      },
    });

    expect(mocks.transitionSvc.applyTransition).toHaveBeenCalledWith(
      mocks.taskRepo.manager,
      expect.objectContaining({
        projectId: 'project-1',
        task: root,
        targetStatus: activeStatus,
        actorUser,
        progress: 75,
        reason: 'More work needed',
      }),
    );
    expect(
      mocks.progressSvc.recalculateProjectTaskProgress,
    ).toHaveBeenCalledWith(mocks.taskRepo.manager, 'project-1');
    expect(mocks.activitySvc.log).toHaveBeenCalledWith(
      mocks.taskRepo.manager,
      root,
      actorUser,
      'task:updated',
      expect.objectContaining({
        operation: 'task_reopened',
        previousStatusId: doneStatus.id,
        nextStatusId: activeStatus.id,
      }),
    );
  });

  it('propagates completion invariant conflicts when reopen is blocked', async () => {
    const doneStatus = status('done', {
      category: StatusCategory.DONE,
      isTerminal: true,
      isDone: true,
    });
    const activeStatus = status('active-2');
    const root = task('root', {
      statusId: doneStatus.id,
      status: doneStatus,
      completed: true,
      progress: 100,
    });
    const conflict = new ConflictException({
      message:
        'Task cannot be moved to Done until required work items are complete.',
      code: 'TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS',
      details: {
        openChecklistItemIds: [],
        openChildTaskIds: [root.id],
        openChecklistItems: [],
        openChildTasks: [
          {
            id: root.id,
            title: root.title,
            statusId: doneStatus.id,
            progress: 100,
          },
        ],
      },
    });
    const mocks = serviceWithMocks();
    mocks.authSvc.verifyProjectPermission.mockResolvedValue({
      membership: { id: 'membership-1' },
    });
    mocks.taskRepo.findOne.mockResolvedValue(root);
    mocks.userRepo.findOneOrFail.mockResolvedValue(actorUser);
    mocks.projectStatusRepo.findOne.mockResolvedValue(activeStatus);
    mocks.transitionSvc.applyTransition.mockRejectedValue(conflict);

    await expect(
      mocks.service.reopenTask(
        'project-1',
        root.id,
        { statusId: activeStatus.id },
        requestUser,
        jest.fn(),
      ),
    ).rejects.toBe(conflict);
    expect(mocks.activitySvc.log).not.toHaveBeenCalled();
  });

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
