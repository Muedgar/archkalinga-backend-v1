import { randomUUID } from 'crypto';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { RequestUser } from 'src/auth/types';
import type { Server } from 'http';
import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard, ProjectPermissionGuard } from 'src/auth/guards';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptor';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { CompletionPolicy, StatusCategory } from '../project-config';
import { ConfigService } from '@nestjs/config';
import {
  Project,
  ProjectMembership,
  ProjectRole,
  ProjectActivityLog,
} from 'src/projects/entities';
import { ProjectType } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities';
import { Workspace } from 'src/workspaces/entities';
import { OutboxService } from 'src/outbox/outbox.service';
import { OutboxEvent } from 'src/outbox/outbox-event.entity';
import { MinioService } from 'src/common/services';
import {
  ChecklistDependency,
  Task,
  TaskDocument,
  TaskDocumentAttachment,
  TaskDocumentType,
  TaskAssignee,
  TaskActivitySchedule,
  TaskActivityLog,
  TaskChecklistItem,
  TaskDependency,
  ProjectCalendar,
  ProjectCalendarException,
  TaskScheduleCalculationRun,
  TaskScheduleExplanation,
} from '../entities';
import { ProjectStatus, ProjectTaskType } from '../project-config';
import { TaskCrudService } from './task-crud.service';
import { TaskRelationsService } from './task-relations.service';
import { TaskLabel } from '../entities';
import { ProjectLabel } from '../project-config';
import { TaskPackageService } from './task-package.service';
import { TaskAuthService } from './task-auth.service';
import { TaskMembersService } from './task-members.service';
import { TaskActivityService } from './task-activity.service';
import { TaskProgressService } from './task-progress.service';
import { TaskRankingService } from './task-ranking.service';
import { TaskWbsService } from './task-wbs.service';
import { TaskCompletionTransitionService } from './task-completion-transition.service';
import { ScheduleCalculationService } from './schedule-calculation.service';
import { DeferChecklistBranching1789800000000 } from 'src/migrations/1789800000000-defer-checklist-branching';
import { AddTaskEarliestStartDate1789700000000 } from 'src/migrations/1789700000000-add-task-earliest-start-date';

// Explicit test database only. Every suite owns a fresh, uniquely named schema.
const describeDatabase = process.env.TASK_PACKAGE_TEST_PG_HOST
  ? describe
  : describe.skip;
describeDatabase('Task packages against PostgreSQL', () => {
  let db: DataSource;
  let service: TaskPackageService;
  let project: Project;
  let actor: User;
  let status: ProjectStatus;
  let role: ProjectRole;
  let schedule: ScheduleCalculationService;
  let activity: TaskActivityService;
  let auth: TaskAuthService;
  const canView = jest.fn().mockResolvedValue(true);
  const branchPermission = jest.fn().mockResolvedValue(undefined);
  let storage: { uploadFile: jest.Mock; deleteFile: jest.Mock };
  let objects: Set<string>;
  const schema = `task_package_test_${randomUUID().replace(/-/g, '')}`;
  const tracked = [
    Task,
    TaskAssignee,
    TaskActivitySchedule,
    TaskChecklistItem,
    TaskDependency,
    ChecklistDependency,
    TaskDocument,
    TaskDocumentAttachment,
    TaskActivityLog,
    ProjectActivityLog,
    OutboxEvent,
    TaskScheduleCalculationRun,
    TaskScheduleExplanation,
  ];
  const counts = async () =>
    Promise.all(tracked.map((entity) => db.getRepository(entity).count()));
  const file = (fieldname = 'file_0') => ({
    fieldname,
    originalname: 'drawing.pdf',
    mimetype: 'application/pdf',
    size: 4,
    buffer: Buffer.from('test'),
  });
  const payload = () => ({
    checklistMode: 'UNBRANCHED',
    task: {
      title: 'Foundation',
      statusId: status.id,
      scheduleType: 'task',
      assignedMembers: [],
      reportee: { userId: randomUUID() },
    },
    generalStarterDocuments: [
      { name: 'Drawing', type: 'STARTER', mode: 'UPLOAD', fileKey: 'file_0' },
    ],
    checklists: ['a', 'b'].map((clientId) => ({
      clientId,
      title: `Checklist ${clientId}`,
      statusId: status.id,
      scheduleType: 'task',
      assignedMembers: [],
      reportee: null,
      plannedStartDate: '2026-09-14',
      durationDays: 2,
      starterDocuments: [],
      deliverableDocuments: [
        {
          name: 'Expected report',
          description: 'Completed inspection',
          type: 'DELIVERABLE',
          mode: 'DEFINE',
        },
      ],
    })),
    dependencies: [
      {
        checklistClientId: 'b',
        dependsOnChecklistClientId: 'a',
        dependencyType: 'FS',
        lagDays: 0,
      },
    ],
  });
  const create = (body: unknown = payload(), files = [file()]) =>
    service.create(project.id, JSON.stringify(body), files, {
      id: actor.id,
    } as RequestUser);

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      host: process.env.TASK_PACKAGE_TEST_PG_HOST,
      port: Number(process.env.TASK_PACKAGE_TEST_PG_PORT || 5432),
      username: process.env.TASK_PACKAGE_TEST_PG_USER || 'postgres',
      database: process.env.TASK_PACKAGE_TEST_PG_DATABASE || 'postgres',
      schema,
      entities: [join(process.cwd(), 'src/**/*.entity.ts')],
      synchronize: false,
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public',
    );
    // This unrelated audit entity has circular enum metadata in the existing app.
    // Package creation never reads it; omit its table from this isolated fixture.
    db.getMetadata('ChangeRequestAuditEntry').synchronize = false;
    await db.synchronize();
    actor = await db.getRepository(User).save({
      firstName: 'Test',
      lastName: 'Creator',
      email: 'creator@example.test',
      password: 'test-only',
    });
    const workspace = await db
      .getRepository(Workspace)
      .save({ name: 'Test', slug: randomUUID() });
    project = await db.getRepository(Project).save({
      title: 'Test project',
      type: ProjectType.ARCHITECTURE,
      startDate: '2026-09-14',
      workspace,
      workspaceId: workspace.id,
      createdByUser: actor,
      createdByUserId: actor.id,
    });
    status = await db.getRepository(ProjectStatus).save({
      project,
      projectId: project.id,
      name: 'Active',
      key: 'active',
      isDefault: true,
      isActive: true,
    });
    await db.getRepository(ProjectTaskType).save({
      project,
      projectId: project.id,
      name: 'Task',
      key: 'task',
      isDefault: true,
    });
    role = await db.getRepository(ProjectRole).save({
      project,
      projectId: project.id,
      name: 'Creator',
      slug: 'creator',
      permissions: {},
    });
    await db.getRepository(ProjectMembership).save({
      project,
      projectId: project.id,
      user: actor,
      userId: actor.id,
      projectRole: role,
      projectRoleId: role.id,
    });
    auth = Object.create(TaskAuthService.prototype) as TaskAuthService;
    Object.assign(auth, {
      taskRepo: db.getRepository(Task),
      checklistItemRepo: db.getRepository(TaskChecklistItem),
    });
    auth.verifyProjectPermission = jest.fn().mockResolvedValue({ project });
    auth.canViewTask = canView;
    auth.assertTaskChecklistBranchAllowed = branchPermission;
    auth.canBranchTaskChecklistItem = jest.fn().mockResolvedValue(true);
    const members = Object.create(
      TaskMembersService.prototype,
    ) as TaskMembersService;
    activity = new TaskActivityService(
      db.getRepository(TaskActivityLog),
      db.getRepository(ProjectActivityLog),
      db.getRepository(Task),
      new OutboxService(
        db.getRepository(OutboxEvent),
        {} as ConstructorParameters<typeof OutboxService>[1],
      ),
      auth,
    );
    schedule = new ScheduleCalculationService(
      db.getRepository(Project),
      db.getRepository(Task),
      db.getRepository(ProjectCalendar),
      db.getRepository(ProjectCalendarException),
      db.getRepository(TaskDependency),
      db.getRepository(TaskActivitySchedule),
      db.getRepository(TaskScheduleCalculationRun),
      db.getRepository(TaskScheduleExplanation),
    );
    objects = new Set();
    storage = {
      uploadFile: jest.fn(({ fileName }: { fileName: string }) => {
        objects.add(fileName);
        return Promise.resolve();
      }),
      deleteFile: jest.fn((_bucket: string, fileName: string) => {
        objects.delete(fileName);
        return Promise.resolve();
      }),
    };
    service = new TaskPackageService(
      db.getRepository(Task),
      auth,
      activity,
      new TaskRankingService(db.getRepository(Task)),
      members,
      new TaskProgressService(db.getRepository(Task)),
      new TaskWbsService(),
      schedule,
      new TaskCompletionTransitionService(),
      storage as unknown as MinioService,
      new ConfigService(),
    );
  }, 30000);

  beforeEach(() => {
    canView.mockResolvedValue(true);
    branchPermission.mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('commits the full tree and derives parent dates; earliest starts survive recalculation', async () => {
    const result = await create();
    expect(result.documentCount).toBe(3);
    expect(result.dependencyCount).toBe(1);
    expect(result.parentTask.reportee?.userId).toBe(actor.id);
    expect(result.parentTask.childCount).toBe(0);
    expect(result.parentTask.checklistItems).toHaveLength(2);
    expect(result.parentTask.assignedMembers).toEqual([]);
    expect(result.checklistTasks).toEqual([]);
    for (const item of result.checklistItems) {
      expect(item.branchedTaskId).toBeNull();
      expect(item.branchStatus).toBe('flat');
      expect(item.canBranch).toBe(true);
    }
    expect(result.checklistItems[0].plannedStartDate).toBe('2026-09-14');
    expect(result.checklistItems[1].plannedStartDate).toBe('2026-09-16');
    expect(result.parentTask.plannedEndDate).toBe(
      result.checklistItems[1].plannedEndDate,
    );
    const definitions = await db.getRepository(TaskDocument).find({
      where: { type: TaskDocumentType.DELIVERABLE },
      relations: ['attachments'],
    });
    expect(definitions.every((d) => !d.attachments.length)).toBe(true);
    await db
      .getRepository(TaskChecklistItem)
      .update({ id: result.checklistItems[0].id }, { durationDays: 5 });
    await schedule.recalculateProject(project.id);
    let successor = await db
      .getRepository(TaskChecklistItem)
      .findOneByOrFail({ id: result.checklistItems[1].id });
    expect(successor.plannedStartDate).toBe('2026-09-21');
    await db
      .getRepository(TaskChecklistItem)
      .update({ id: result.checklistItems[0].id }, { durationDays: 1 });
    await schedule.recalculateProject(project.id);
    successor = await db
      .getRepository(TaskChecklistItem)
      .findOneByOrFail({ id: result.checklistItems[1].id });
    expect(successor.plannedStartDate).toBe('2026-09-15');
    expect(successor.earliestStartDate).toBe('2026-09-14');
  });

  it('creates a task without checklists and accepts optional active-member assignments', async () => {
    const result = await create(
      {
        task: {
          ...payload().task,
          assignedMembers: [{ userId: actor.id, projectRoleId: role.id }],
        },
      },
      [],
    );
    expect(result.checklistTasks).toEqual([]);
    expect(result.parentTask.assignedMembers[0].userId).toBe(actor.id);
  });

  it('keeps same-named uploads distinct by fileKey', async () => {
    const body = payload();
    body.generalStarterDocuments.push({
      ...body.generalStarterDocuments[0],
      fileKey: 'file_1',
    });
    const result = await create(body, [file(), file('file_1')]);
    const docs = await db.getRepository(TaskDocument).find({
      where: { taskId: result.parentTask.id },
      relations: ['attachments'],
    });
    expect(
      new Set(
        docs
          .filter((d) => d.type === TaskDocumentType.STARTER)
          .map((d) => d.attachments[0].filename),
      ).size,
    ).toBe(2);
  });

  it('pins the exact existing deliverable attachment UUID and enforces visibility and ownership', async () => {
    const sourceTask = (await create({ task: payload().task }, [])).parentTask;
    const document = await db.getRepository(TaskDocument).save({
      taskId: sourceTask.id,
      createdByUserId: actor.id,
      type: TaskDocumentType.DELIVERABLE,
      name: 'Existing output',
    });
    const source = await db.getRepository(TaskDocumentAttachment).save({
      documentId: document.id,
      createdByUserId: actor.id,
      filename: 'existing.pdf',
      bucketName: 'task-documents',
    });
    const doc = {
      name: 'Input',
      type: 'STARTER',
      mode: 'FROM_DELIVERABLE',
      sourceAttachmentId: source.id,
    };
    const result = await create(
      { task: payload().task, generalStarterDocuments: [doc] },
      [],
    );
    const copied = await db.getRepository(TaskDocument).findOneOrFail({
      where: { taskId: result.parentTask.id },
      relations: ['attachments'],
    });
    expect(copied.attachments[0].sourceAttachmentId).toBe(source.id);
    expect(copied.attachments[0].filename).toBe('existing.pdf');
    await expect(
      create(
        {
          task: payload().task,
          generalStarterDocuments: [{ ...doc, sourceTaskId: randomUUID() }],
        },
        [],
      ),
    ).rejects.toThrow('owner');
    jest.spyOn(auth, 'canViewTask').mockResolvedValue(false);
    await expect(
      create({ task: payload().task, generalStarterDocuments: [doc] }, []),
    ).rejects.toThrow('unavailable');
  });

  it.each(['schedule', 'event'])(
    'rolls back every DB record and cleans uploaded files after %s failure',
    async (stage) => {
      const before = await counts();
      const objectsBefore = new Set(objects);
      if (stage === 'schedule')
        jest
          .spyOn(schedule, 'recalculateProject')
          .mockRejectedValueOnce(new Error('Injected schedule failure'));
      else {
        const log = activity.log.bind(activity) as TaskActivityService['log'];
        jest.spyOn(activity, 'log').mockImplementationOnce(async (...args) => {
          await log(...args);
          // A different connection cannot see the uncommitted package or its outbox events.
          expect(await counts()).toEqual(before);
          throw new Error('Injected event failure');
        });
      }
      await expect(create()).rejects.toThrow('Injected');
      expect(await counts()).toEqual(before);
      expect(objects).toEqual(objectsBefore);
    },
  );

  it('cleans all attempted objects when a later upload fails after writing', async () => {
    const before = await counts();
    const objectsBefore = new Set(objects);
    const body = payload();
    body.generalStarterDocuments.push({
      ...body.generalStarterDocuments[0],
      fileKey: 'file_1',
    });
    storage.uploadFile
      .mockImplementationOnce(({ fileName }: { fileName: string }) => {
        objects.add(fileName);
        return Promise.resolve();
      })
      .mockImplementationOnce(({ fileName }: { fileName: string }) => {
        objects.add(fileName);
        return Promise.reject(new Error('Upload failed'));
      });
    await expect(create(body, [file(), file('file_1')])).rejects.toThrow(
      'Upload failed',
    );
    expect(await counts()).toEqual(before);
    expect(objects).toEqual(objectsBefore);
  });

  it('rejects unmapped files and invalid members before uploading', async () => {
    const uploads = storage.uploadFile.mock.calls.length;
    await expect(create(payload(), [file('wrong')])).rejects.toThrow('fileKey');
    await expect(
      create({
        ...payload(),
        task: {
          ...payload().task,
          assignedMembers: [{ userId: randomUUID() }],
        },
      }),
    ).rejects.toThrow('membership');
    expect(storage.uploadFile.mock.calls.length).toBe(uploads);
  });

  it('accepts multipart HTTP requests and returns the existing response envelope', async () => {
    const module = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: {} },
        { provide: TaskPackageService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ user: RequestUser }>().user = {
            id: actor.id,
          } as RequestUser;
          return true;
        },
      })
      .overrideGuard(ProjectPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
    try {
      const result = await request(app.getHttpServer() as Server)
        .post(`/projects/${project.id}/task-packages`)
        .field('payload', JSON.stringify(payload()))
        .attach('file_0', Buffer.from('drawing'), 'drawing.pdf')
        .expect(201);
      const body = result.body as {
        message: string;
        data: Awaited<ReturnType<TaskPackageService['create']>>;
      };
      expect(body.message).toBe('Task package created');
      expect(body.data.parentTask.reportee?.userId).toBe(actor.id);
      expect(body.data.checklistTasks).toHaveLength(0);
      expect(body.data.checklistItems).toHaveLength(2);
      await request(app.getHttpServer() as Server)
        .post(`/projects/${project.id}/task-packages`)
        .field('payload', '{')
        .expect(400);
    } finally {
      await app.close();
    }
  });

  it('creates completed packages consistently under strict completion policy', async () => {
    const done = await db.getRepository(ProjectStatus).save({
      project,
      projectId: project.id,
      name: 'Done',
      key: 'done',
      isActive: true,
      category: StatusCategory.DONE,
      isDone: true,
      isTerminal: true,
      completionPolicy: CompletionPolicy.REQUIRE_ALL_WORK_ITEMS_DONE,
    });
    const body = payload();
    body.task.statusId = done.id;
    body.checklists.forEach((item) => {
      item.statusId = done.id;
    });
    const result = await create(body);
    expect(result.parentTask.completed).toBe(true);
    expect(
      result.parentTask.checklistItems.every((item) => item.completed),
    ).toBe(true);
    expect(result.checklistItems.every((item) => item.completed)).toBe(true);
  });

  it('overwrites reportees on standalone task and subtask creation with empty assignees', async () => {
    const members = Object.create(
      TaskMembersService.prototype,
    ) as TaskMembersService;
    const relations = {
      ensureDependencyTasks: () => Promise.resolve([]),
      upsertViewMetadata: () => Promise.resolve(),
    } as unknown as TaskRelationsService;
    jest
      .spyOn(auth, 'ensureParentTask')
      .mockImplementation((_projectId, parentId) =>
        parentId
          ? db.getRepository(Task).findOneBy({ id: parentId })
          : Promise.resolve(null),
      );
    const crud = new TaskCrudService(
      db.getRepository(Task),
      db.getRepository(TaskAssignee),
      db.getRepository(TaskChecklistItem),
      db.getRepository(TaskDependency),
      db.getRepository(User),
      db.getRepository(ProjectStatus),
      db.getRepository(ProjectTaskType),
      db.getRepository(TaskLabel),
      db.getRepository(ProjectLabel),
      db.getRepository(TaskActivitySchedule),
      auth,
      new TaskRankingService(db.getRepository(Task)),
      activity,
      members,
      relations,
      schedule,
      new TaskProgressService(db.getRepository(Task)),
      new TaskWbsService(),
      new TaskCompletionTransitionService(),
    );
    const read = async (_projectId: string, taskId: string) =>
      auth.toTaskSerializer(
        await db.getRepository(Task).findOneByOrFail({ id: taskId }),
      );
    const input = {
      title: 'Standalone',
      statusId: status.id,
      assignedMembers: [],
      reportee: { userId: randomUUID() },
    };
    const parent = await crud.createTask(
      project.id,
      input,
      { id: actor.id } as RequestUser,
      read,
    );
    const child = await crud.createTask(
      project.id,
      { ...input, parentTaskId: parent.id },
      { id: actor.id } as RequestUser,
      read,
    );
    for (const id of [parent.id, child.id]) {
      const task = await db
        .getRepository(Task)
        .findOneOrFail({ where: { id }, relations: ['reporteeUser'] });
      expect(task.reporteeUserId).toBe(actor.id);
      expect(task.reporteeUser?.id).toBe(actor.id);
    }
  });

  it('stores checklist descriptions, documents, assignments and dependency ownership without child tasks', async () => {
    const body = payload();
    Object.assign(body.checklists[0], {
      description: {
        type: 'doc',
        content: [{ type: 'text', text: 'Checklist description' }],
      },
      assignedMembers: [{ userId: actor.id, projectRoleId: role.id }],
    });
    const before = await db.getRepository(Task).count();
    const result = await create(body);
    expect(await db.getRepository(Task).count()).toBe(before + 1);
    expect(result.checklistItems[0].description).toMatchObject({ type: 'doc' });
    const item = await db
      .getRepository(TaskChecklistItem)
      .findOneByOrFail({ id: result.checklistItems[0].id });
    expect(item.reporteeUserId).toBe(actor.id);
    expect(item.assignedMembers[0].userId).toBe(actor.id);
    const doc = await db
      .getRepository(TaskDocument)
      .findOneByOrFail({ checklistItemId: item.id });
    expect(doc.type).toBe(TaskDocumentType.DELIVERABLE);
    const dep = await db
      .getRepository(ChecklistDependency)
      .findOneByOrFail({ checklistItemId: result.checklistItems[1].id });
    expect(dep.dependsOnChecklistItemId).toBe(item.id);
  });

  it('branches exactly once under concurrent submissions and preserves the source', async () => {
    const source = await create();
    const sourceId = source.checklistItems[0].id;
    const branchFrom = {
      taskId: source.parentTask.id,
      checklistItemId: sourceId,
    };
    const before = await db.getRepository(Task).count();
    const results = await Promise.allSettled([
      create({ ...payload(), branchFrom }),
      create({ ...payload(), branchFrom }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect((failure.reason as { getStatus(): number }).getStatus()).toBe(409);
    expect(await db.getRepository(Task).count()).toBe(before + 1);
    const linked = await db
      .getRepository(TaskChecklistItem)
      .findOneByOrFail({ id: sourceId });
    expect(linked.text).toBe(source.checklistItems[0].text);
    expect(linked.branchStatus).toBe('branched');
    const created = await db
      .getRepository(Task)
      .findOneByOrFail({ id: linked.branchedTaskId! });
    expect(created.parentTaskId).toBe(source.parentTask.id);
    const items = await db
      .getRepository(TaskChecklistItem)
      .findBy({ taskId: created.id });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.branchedTaskId === null)).toBe(true);
    await auth.decorateChecklistRead(created, items, {
      id: actor.id,
    } as RequestUser);
    expect(items.every((i) => i.canBranch)).toBe(true);
    await auth.decorateChecklistRead(created, [linked], {
      id: actor.id,
    } as RequestUser);
    expect(linked.canBranch).toBe(false);
  });

  it('rolls back the source link, new records and uploads when branching fails after linking', async () => {
    const source = await create();
    const before = await counts();
    const beforeObjects = new Set(objects);
    jest
      .spyOn(schedule, 'recalculateProject')
      .mockRejectedValueOnce(new Error('Branch schedule failure'));
    await expect(
      create({
        ...payload(),
        branchFrom: {
          taskId: source.parentTask.id,
          checklistItemId: source.checklistItems[0].id,
        },
      }),
    ).rejects.toThrow('Branch schedule failure');
    expect(await counts()).toEqual(before);
    expect(objects).toEqual(beforeObjects);
    expect(
      (
        await db
          .getRepository(TaskChecklistItem)
          .findOneByOrFail({ id: source.checklistItems[0].id })
      ).branchedTaskId,
    ).toBeNull();
  });

  it('rejects empty, unauthorized, completed and mismatched branches before uploads', async () => {
    const source = await create();
    const branchFrom = {
      taskId: source.parentTask.id,
      checklistItemId: source.checklistItems[0].id,
    };
    const uploads = storage.uploadFile.mock.calls.length;
    await expect(
      create({ ...payload(), branchFrom, checklists: [] }),
    ).rejects.toThrow('at least one');
    await expect(
      create({
        ...payload(),
        branchFrom: { ...branchFrom, taskId: randomUUID() },
      }),
    ).rejects.toThrow('specified task');
    jest
      .spyOn(auth, 'assertTaskChecklistBranchAllowed')
      .mockRejectedValueOnce(new Error('Forbidden branch'));
    await expect(create({ ...payload(), branchFrom })).rejects.toThrow(
      'Forbidden branch',
    );
    await db
      .getRepository(TaskChecklistItem)
      .update({ id: branchFrom.checklistItemId }, { completed: true });
    await expect(create({ ...payload(), branchFrom })).rejects.toThrow(
      'reopened',
    );
    expect(storage.uploadFile.mock.calls.length).toBe(uploads);
  });

  it('aggregates checklist progress without double-counting a branched task', async () => {
    const source = await create();
    const branch = await create({
      ...payload(),
      branchFrom: {
        taskId: source.parentTask.id,
        checklistItemId: source.checklistItems[0].id,
      },
    });
    await db
      .getRepository(TaskChecklistItem)
      .update({ id: branch.checklistItems[0].id }, { completed: true });
    await db
      .getRepository(TaskChecklistItem)
      .update({ id: source.checklistItems[1].id }, { completed: true });
    await db.transaction((tx) =>
      new TaskProgressService(
        db.getRepository(Task),
      ).recalculateProjectTaskProgress(tx, project.id),
    );
    expect(
      (
        await db
          .getRepository(Task)
          .findOneByOrFail({ id: branch.parentTask.id })
      ).progress,
    ).toBe(50);
    expect(
      (
        await db
          .getRepository(Task)
          .findOneByOrFail({ id: source.parentTask.id })
      ).progress,
    ).toBe(75);
  });

  it.each([
    ['FS', '2026-09-21'],
    ['SS', '2026-09-17'],
    ['FF', '2026-09-18'],
    ['SF', '2026-09-16'],
  ])(
    'schedules %s checklist dependencies with fixed working-day durations',
    async (dependencyType, expectedStart) => {
      const body = payload();
      body.checklists[0].plannedStartDate = '2026-09-17';
      body.checklists[1].durationDays = 1;
      body.dependencies[0].dependencyType = dependencyType;
      const result = await create(body);
      expect(result.checklistItems[1].plannedStartDate).toBe(expectedStart);
      expect(
        (
          await db
            .getRepository(TaskChecklistItem)
            .findOneByOrFail({ id: result.checklistItems[1].id })
        ).durationDays,
      ).toBe(1);
    },
  );

  it('returns inverse source descriptions and accurate branching permissions', async () => {
    const body = payload();
    Object.assign(body.checklists[0], {
      description: {
        type: 'doc',
        content: [{ type: 'text', text: 'Original checklist only' }],
      },
    });
    const source = await create(body);
    const result = await create({
      ...payload(),
      branchFrom: {
        taskId: source.parentTask.id,
        checklistItemId: source.checklistItems[0].id,
      },
    });
    const task = await db.getRepository(Task).findOneOrFail({
      where: { id: result.parentTask.id },
      relations: ['checklistItems'],
    });
    await auth.decorateTaskChecklistRead(task, { id: actor.id } as RequestUser);
    const response = auth.toTaskSerializer(task);
    expect(response.branchedFromChecklist?.checklistItemId).toBe(
      source.checklistItems[0].id,
    );
    expect(response.branchedFromChecklist?.description).toMatchObject({
      type: 'doc',
    });
    expect(response.checklistItems.every((i) => i.canBranch)).toBe(true);
    jest
      .spyOn(auth, 'verifyProjectPermission')
      .mockRejectedValueOnce(new Error('No task-create permission'));
    await auth.decorateChecklistRead(task, task.checklistItems, {
      id: actor.id,
    } as RequestUser);
    expect(task.checklistItems.every((i) => !i.canBranch)).toBe(true);
    jest.spyOn(auth, 'canBranchTaskChecklistItem').mockResolvedValueOnce(false);
    await auth.decorateChecklistRead(task, task.checklistItems, {
      id: actor.id,
    } as RequestUser);
    expect(task.checklistItems.every((i) => !i.canBranch)).toBe(true);
  });

  it('migrates legacy branches without disconnecting tasks, files, dependencies or history', async () => {
    const q = db.createQueryRunner();
    await q.connect();
    const legacySchema = `${schema}_legacy`;
    const owner = randomUUID(),
      child = randomUUID(),
      itemId = randomUUID(),
      docId = randomUUID();
    try {
      await q.query(`CREATE SCHEMA "${legacySchema}"`);
      await q.query(`SET search_path TO "${legacySchema}", public`);
      await q.query(`CREATE TABLE tasks (id uuid PRIMARY KEY, description jsonb, "reporteeUserId" uuid, title text);
        CREATE TABLE task_checklist_items (id uuid PRIMARY KEY, "taskId" uuid, branched_task_id uuid, branch_status text);
        CREATE TABLE task_documents (id uuid PRIMARY KEY, task_id uuid, description text);
        CREATE TABLE task_activity_schedules (task_id uuid, duration_days numeric, earliest_start_date date, planned_start_date date, planned_end_date date);
        CREATE TABLE task_dependencies (id uuid PRIMARY KEY, "taskId" uuid, "dependsOnTaskId" uuid);
        CREATE TABLE task_activity_logs (id uuid PRIMARY KEY, "taskId" uuid, "actionMeta" jsonb);
        CREATE TABLE task_comments (id uuid PRIMARY KEY, "taskId" uuid, body text);
        CREATE TABLE task_document_attachments (id uuid PRIMARY KEY, document_id uuid, filename text)`);
      await q.query(
        `INSERT INTO tasks VALUES ($1, '{"type":"doc","content":[]}', $2, 'Existing work')`,
        [child, actor.id],
      );
      await q.query(
        `INSERT INTO task_checklist_items VALUES ($1,$2,$3,'branched')`,
        [itemId, owner, child],
      );
      await q.query(
        `INSERT INTO task_documents VALUES ($1,$2,'Original document')`,
        [docId, child],
      );
      await q.query(
        `INSERT INTO task_document_attachments VALUES ($1,$2,'original.pdf')`,
        [randomUUID(), docId],
      );
      await q.query(`INSERT INTO task_dependencies VALUES ($1,$2,$3)`, [
        randomUUID(),
        child,
        owner,
      ]);
      await q.query(
        `INSERT INTO task_activity_schedules VALUES ($1,3,'2026-09-14','2026-09-14','2026-09-17')`,
        [child],
      );
      await q.query(
        `INSERT INTO task_comments VALUES ($1,$2,'Existing work history')`,
        [randomUUID(), child],
      );
      await q.query(`INSERT INTO task_activity_logs VALUES ($1,$2,$3)`, [
        randomUUID(),
        child,
        { packageParentTaskId: owner },
      ]);
      const migration = new DeferChecklistBranching1789800000000();
      await q.startTransaction();
      await migration.up(q);
      await q.commitTransaction();
      const rows = (await q.query(
        `SELECT * FROM task_checklist_items WHERE id=$1`,
        [itemId],
      )) as {
        branched_task_id: string;
        legacy_branch: boolean;
        description: unknown;
        duration_days: string;
      }[];
      expect(rows[0].branched_task_id).toBe(child);
      expect(rows[0].legacy_branch).toBe(true);
      expect(rows[0].description).toEqual({ type: 'doc', content: [] });
      expect(Number(rows[0].duration_days)).toBe(3);
      const audit = (await q.query(
        `SELECT * FROM checklist_legacy_branch_records`,
      )) as {
        automatically_created: boolean;
        disposition: string;
        snapshot: { documents: unknown[]; dependencies: unknown[] };
      }[];
      expect(audit[0].automatically_created).toBe(true);
      expect(audit[0].disposition).toBe('RETAINED_LINK');
      expect(audit[0].snapshot.documents).toHaveLength(1);
      expect(audit[0].snapshot.dependencies).toHaveLength(1);
      for (const table of [
        'tasks',
        'task_comments',
        'task_documents',
        'task_document_attachments',
        'task_dependencies',
        'task_activity_logs',
      ]) {
        const count = (await q.query(
          `SELECT COUNT(*) AS count FROM ${table}`,
        )) as { count: string }[];
        expect(Number(count[0].count)).toBe(1);
      }
      await q.query(`UPDATE task_checklist_items SET package_managed=true`);
      await expect(migration.down(q)).rejects.toThrow('contains package data');
      await q.query(`UPDATE task_checklist_items SET package_managed=false`);
      await migration.down(q);
      const remaining = (await q.query(
        `SELECT branched_task_id FROM task_checklist_items`,
      )) as { branched_task_id: string }[];
      expect(remaining[0].branched_task_id).toBe(child);
    } finally {
      if (q.isTransactionActive) await q.rollbackTransaction();
      await q.query('RESET search_path');
      await q.query(`DROP SCHEMA IF EXISTS "${legacySchema}" CASCADE`);
      await q.release();
    }
  });

  it('applies and reverses the earliest-start migration', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.query(`SET search_path TO "${schema}", public`);
    const migration = new AddTaskEarliestStartDate1789700000000();
    await migration.down(runner);
    await migration.up(runner);
    await runner.query(`RESET search_path`);
    await runner.release();
    expect(
      await db.getRepository(TaskActivitySchedule).count(),
    ).toBeGreaterThan(0);
  });
});
