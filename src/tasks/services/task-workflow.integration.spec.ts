import { TaskSyncEventsService } from './task-sync-events.service';
import { TaskSyncEvent, TaskSyncEventType } from '../entities';
import { auditWorkflow } from '../workflow/workflow-audit';
import { TaskWorkflowActivation } from '../entities';
import { SearchService } from 'src/search/search.service';
import { SearchRecentItem } from 'src/search/entities';
import { ClassifyChecklistWorkflow1790000001000 } from 'src/migrations/1790000001000-classify-checklist-workflow';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { User } from 'src/users/entities';
import {
  Project,
  ProjectMembership,
  ProjectRole,
  ProjectActivityLog,
} from 'src/projects/entities';
import { ProjectType } from 'src/projects/entities/project.entity';
import { Workspace, WorkspaceMember } from 'src/workspaces/entities';
import {
  Task,
  TaskAssignee,
  TaskChecklistItem,
  ChecklistSubmission,
  ChecklistSubmissionEvidence,
  ChecklistReviewNote,
  TaskDocument,
  TaskDocumentAttachment,
  TaskDocumentType,
  TaskActivityLog,
  ChecklistDependency,
} from '../entities';
import {
  CanonicalStage as S,
  ProjectStatus,
} from '../project-config/project-status.entity';
import { ProjectTaskType } from '../project-config';
import { TaskAuthService } from './task-auth.service';
import { TaskWorkflowService } from './task-workflow.service';
import { TaskChecklistTransitionService } from './task-checklist-transition.service';
import { TaskActivityService } from './task-activity.service';
import { TaskDocumentsService } from './task-documents.service';
import { TaskPackageService } from './task-package.service';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { JwtAuthGuard, ProjectPermissionGuard } from 'src/auth/guards';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptor';
import { OutboxService } from 'src/outbox/outbox.service';
import { OutboxEvent } from 'src/outbox/outbox-event.entity';
import { lockWorkflow, rollupStatuses } from '../workflow/workflow-domain';

const databaseSuite = process.env.TASK_WORKFLOW_TEST_PG_HOST
  ? describe
  : describe.skip;
databaseSuite('Checklist workflow against migrated PostgreSQL', () => {
  let db: DataSource,
    auth: TaskAuthService,
    workflow: TaskWorkflowService,
    docs: TaskDocumentsService,
    app: any;
  let project: Project,
    reporter: User,
    worker: User,
    outsider: User,
    task: Task,
    item: TaskChecklistItem;
  let statuses: Map<S, ProjectStatus>, taskType: ProjectTaskType;
  const asActor = (u: User) => u as any;
  const current = () =>
    db.manager.findOneByOrFail(TaskChecklistItem, { id: item.id });
  const command = async (user: User, intent: any, extra: any = {}) =>
    workflow.execute(project.id, task.id, item.id, asActor(user), {
      expectedRevision: (await current()).version,
      idempotencyKey: randomUUID(),
      intent,
      ...extra,
    });
  beforeAll(async () => {
    const database = process.env.TASK_WORKFLOW_TEST_PG_DATABASE!;
    if (!database?.endsWith('_test'))
      throw new Error('Explicit disposable *_test database required');
    db = new DataSource({
      type: 'postgres',
      host: process.env.TASK_WORKFLOW_TEST_PG_HOST,
      port: Number(process.env.TASK_WORKFLOW_TEST_PG_PORT ?? 55439),
      username: process.env.TASK_WORKFLOW_TEST_PG_USER ?? process.env.USER,
      database,
      entities: ['src/**/*.entity.ts'],
      migrations: ['src/migrations/*.ts'],
      synchronize: false,
    });
    await db.initialize();
    await db.runMigrations();
    auth = Object.create(TaskAuthService.prototype);
    Object.assign(auth, {
      taskRepo: db.getRepository(Task),
      projectRepo: db.getRepository(Project),
      membershipRepo: db.getRepository(ProjectMembership),
      workspaceMemberRepo: db.getRepository(WorkspaceMember),
      projectStatusRepo: db.getRepository(ProjectStatus),
      checklistItemRepo: db.getRepository(TaskChecklistItem),
    });
    const activity = new TaskActivityService(
      db.getRepository(TaskActivityLog),
      db.getRepository(ProjectActivityLog),
      db.getRepository(Task),
      new OutboxService(db.getRepository(OutboxEvent), {} as any),
      auth,
    );
    workflow = new TaskWorkflowService(
      db,
      auth,
      activity,
      new TaskChecklistTransitionService(),
    );
    docs = new TaskDocumentsService(
      db.getRepository(TaskDocument),
      db.getRepository(TaskDocumentAttachment),
      db.getRepository(Task),
      activity,
      auth,
      {
        getFileContent: jest.fn().mockResolvedValue(Buffer.from('file')),
        uploadFile: jest.fn(async ({ file }) => ({
          fileName: randomUUID(),
          bucketName: 'test',
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        })),
        deleteFile: jest.fn(),
      } as any,
      new ConfigService(),
    );
    const facade = Object.create(TasksService.prototype);
    Object.assign(facade, {
      workflowSvc: workflow,
      authSvc: auth,
      documentsSvc: docs,
      userRepo: db.getRepository(User),
    });
    const module = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: facade },
        { provide: TaskPackageService, useValue: {} },
        { provide: TaskWorkflowService, useValue: workflow },
        {
          provide: ProjectPermissionGuard,
          useValue: new ProjectPermissionGuard(
            new Reflector(),
            db.getRepository(ProjectMembership),
            db.getRepository(Project),
            {} as any,
            db.getRepository(WorkspaceMember),
          ),
        },
      ],
    })
      .overrideGuard(ProjectPermissionGuard)
      .useValue(
        new ProjectPermissionGuard(
          new Reflector(),
          db.getRepository(ProjectMembership),
          db.getRepository(Project),
          {} as any,
          db.getRepository(WorkspaceMember),
        ),
      )
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: async (ctx) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = await db.manager.findOneBy(User, {
            id: req.headers['x-test-user'],
          });
          return !!req.user;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
  }, 60000);
  beforeEach(async () => {
    const makeUser = async () =>
      db.manager.save(
        User,
        db.manager.create(User, {
          firstName: 'Workflow',
          lastName: 'Test',
          email: `${randomUUID()}@example.test`,
          password: 'test-only',
        }),
      );
    reporter = await makeUser();
    worker = await makeUser();
    outsider = await makeUser();
    const workspace = await db.manager.save(
      Workspace,
      db.manager.create(Workspace, {
        name: 'Workflow test',
        slug: randomUUID(),
      }),
    );
    project = await db.manager.save(
      Project,
      db.manager.create(Project, {
        title: 'Workflow test',
        type: ProjectType.ARCHITECTURE,
        workspace,
        workspaceId: workspace.id,
        createdByUser: reporter,
        createdByUserId: reporter.id,
        startDate: '2026-09-01',
      }),
    );
    const role = await db.manager.save(
      ProjectRole,
      db.manager.create(ProjectRole, {
        project,
        projectId: project.id,
        name: 'No grants',
        slug: randomUUID(),
        permissions: {},
      }),
    );
    for (const user of [reporter, worker, outsider])
      await db.manager.save(
        ProjectMembership,
        db.manager.create(ProjectMembership, {
          project,
          projectId: project.id,
          user,
          userId: user.id,
          projectRole: role,
          projectRoleId: role.id,
        }),
      );
    statuses = new Map();
    for (const stage of Object.values(S)) {
      const status = await db.manager.save(
        ProjectStatus,
        db.manager.create(ProjectStatus, {
          project,
          projectId: project.id,
          name: stage,
          key: stage.toLowerCase(),
          canonicalStage: stage,
          isActive: true,
          isDefault: stage === S.TODO,
          isDone: stage === S.DONE,
          isTerminal: stage === S.DONE,
        }),
      );
      statuses.set(stage, status);
    }
    taskType = await db.manager.save(
      ProjectTaskType,
      db.manager.create(ProjectTaskType, {
        project,
        projectId: project.id,
        name: 'Task',
        key: 'task',
        isDefault: true,
      }),
    );
    task = await makeTask(null);
    await db.manager.save(
      TaskAssignee,
      db.manager.create(TaskAssignee, {
        task,
        taskId: task.id,
        user: worker,
        userId: worker.id,
        projectRoleId: role.id,
      }),
    );
    item = await makeItem(task);
  });
  async function makeTask(parent: Task | null) {
    return db.manager.save(
      Task,
      db.manager.create(Task, {
        project,
        projectId: project.id,
        title: 'Work',
        status: statuses.get(S.TODO),
        statusId: statuses.get(S.TODO)!.id,
        taskType,
        taskTypeId: taskType.id,
        createdByUser: reporter,
        createdByUserId: reporter.id,
        reporteeUser: reporter,
        reporteeUserId: reporter.id,
        parentTaskId: parent?.id ?? null,
        completed: false,
      }),
    );
  }
  async function makeItem(owner: Task) {
    return db.manager.save(
      TaskChecklistItem,
      db.manager.create(TaskChecklistItem, {
        task: owner,
        taskId: owner.id,
        text: 'Checklist',
        statusId: statuses.get(S.TODO)!.id,
        effectiveStage: S.TODO,
        completed: false,
      }),
    );
  }
  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });
  it('HTTP submit works without role grants; retry creates one attempt and one evidence set', async () => {
    const doc = await db.manager.save(
      TaskDocument,
      db.manager.create(TaskDocument, {
        taskId: task.id,
        checklistItemId: item.id,
        type: TaskDocumentType.DELIVERABLE,
        name: 'Drawing',
        createdByUserId: reporter.id,
      }),
    );
    await db.manager.save(
      TaskDocumentAttachment,
      db.manager.create(TaskDocumentAttachment, {
        documentId: doc.id,
        filename: 'original',
        bucketName: 'test',
        createdByUserId: worker.id,
        isActive: true,
      }),
    );
    const body = {
      expectedRevision: item.version,
      idempotencyKey: randomUUID(),
    };
    const url = `/projects/${project.id}/tasks/${task.id}/checklist/${item.id}/submissions`;
    const first = await request(app.getHttpServer())
      .post(url)
      .set('x-test-user', worker.id)
      .send(body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(url)
      .set('x-test-user', worker.id)
      .send(body)
      .expect(201);
    expect(second.body.data.replayed).toBe(true);
    expect(
      await db.manager.count(ChecklistSubmission, {
        where: { checklistItemId: item.id },
      }),
    ).toBe(1);
    expect(
      await db.manager.count(ChecklistSubmissionEvidence, {
        where: { submissionId: first.body.data.submissionEffect.id },
      }),
    ).toBe(1);
    expect((await current()).effectiveStage).toBe(S.IN_REVIEW);
  });
  it('withdrawal, resubmission and reviewer rejection preserve attempts and notes', async () => {
    await command(worker, 'SUBMIT');
    await command(worker, 'WITHDRAW', {
      statusId: statuses.get(S.IN_PROGRESS)!.id,
    });
    await command(worker, 'SUBMIT');
    await command(reporter, 'REJECT', {
      statusId: statuses.get(S.TODO)!.id,
      reviewNote: 'Revise drawing',
    });
    const history = await workflow.history(
      project.id,
      task.id,
      item.id,
      asActor(worker),
      {},
    );
    expect(history.items.map((i) => i.outcome)).toEqual([
      'REJECTED',
      'WITHDRAWN',
    ]);
    expect(history.items[0].notes[0].text).toBe('Revise drawing');
    expect(
      (await db.manager.findOneByOrFail(Task, { id: task.id })).statusId,
    ).toBe(statuses.get(S.TODO)!.id);
  });
  it('accept versus withdraw has one winner and an atomic outcome', async () => {
    await command(worker, 'SUBMIT');
    const revision = (await current()).version;
    const outcomes = await Promise.allSettled([
      workflow.execute(project.id, task.id, item.id, asActor(reporter), {
        intent: 'ACCEPT',
        expectedRevision: revision,
        idempotencyKey: randomUUID(),
      }),
      workflow.execute(project.id, task.id, item.id, asActor(worker), {
        intent: 'WITHDRAW',
        statusId: statuses.get(S.TODO)!.id,
        expectedRevision: revision,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
    const submission = await db.manager.findOneByOrFail(ChecklistSubmission, {
      checklistItemId: item.id,
    });
    expect((await current()).completed).toBe(submission.outcome === 'ACCEPTED');
  });
  it('concurrent duplicate submission requests replay safely', async () => {
    const cmd = {
      intent: 'SUBMIT' as const,
      expectedRevision: item.version,
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all([
      workflow.execute(project.id, task.id, item.id, asActor(worker), cmd),
      workflow.execute(project.id, task.id, item.id, asActor(worker), cmd),
    ]);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(
      await db.manager.count(ChecklistSubmission, {
        where: { checklistItemId: item.id },
      }),
    ).toBe(1);
  });
  it('sibling accept races complete their parent without lost rollups', async () => {
    const other = await makeItem(task);
    await command(worker, 'SUBMIT');
    await workflow.execute(project.id, task.id, other.id, asActor(worker), {
      intent: 'SUBMIT',
      expectedRevision: other.version,
      idempotencyKey: randomUUID(),
    });
    const latestOther = await db.manager.findOneByOrFail(TaskChecklistItem, {
      id: other.id,
    });
    await Promise.all([
      command(reporter, 'ACCEPT'),
      workflow.execute(project.id, task.id, other.id, asActor(reporter), {
        intent: 'ACCEPT',
        expectedRevision: latestOther.version,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(
      (await db.manager.findOneByOrFail(Task, { id: task.id })).completed,
    ).toBe(true);
  });
  it('Done is terminal and assignee-only direct completion is rejected', async () => {
    await expect(command(worker, 'ACCEPT')).rejects.toThrow(
      'CHECKLIST_REVIEW_REQUIRED',
    );
    await command(worker, 'SUBMIT');
    await expect(command(worker, 'ACCEPT')).rejects.toThrow();
    await command(reporter, 'ACCEPT');
    await expect(
      command(worker, 'MOVE', { statusId: statuses.get(S.TODO)!.id }),
    ).rejects.toThrow();
    expect((await current()).completed).toBe(true);
  });
  it('notes retain revisions and reject editing terminal attempts', async () => {
    const result = await command(worker, 'SUBMIT');
    const submissionId = result.submissionEffect!.id;
    const n: any = await workflow.notes(
      project.id,
      task.id,
      item.id,
      submissionId,
      asActor(reporter),
      {
        expectedRevision: (await current()).version,
        idempotencyKey: randomUUID(),
        text: 'First',
      },
    );
    await workflow.notes(
      project.id,
      task.id,
      item.id,
      submissionId,
      asActor(reporter),
      {
        expectedRevision: (await current()).version,
        idempotencyKey: randomUUID(),
        noteId: n.note.noteId,
        expectedNoteRevision: 1,
        text: 'Revised',
      },
    );
    expect(
      await db.manager.count(ChecklistReviewNote, { where: { submissionId } }),
    ).toBe(2);
    await command(reporter, 'ACCEPT');
    await expect(
      workflow.notes(
        project.id,
        task.id,
        item.id,
        submissionId,
        asActor(reporter),
        {
          expectedRevision: (await current()).version,
          idempotencyKey: randomUUID(),
          text: 'Rewrite',
        },
      ),
    ).rejects.toThrow();
  });
  it('replaced/deleted evidence retains exact version metadata and blocks content', async () => {
    const doc: any = await docs.createTaskDocument(task, reporter, {
      name: 'Deliverable',
      type: TaskDocumentType.DELIVERABLE,
      checklistItemId: item.id,
    });
    const old = await db.manager.save(
      TaskDocumentAttachment,
      db.manager.create(TaskDocumentAttachment, {
        documentId: doc.id,
        filename: 'original',
        originalName: 'drawing.pdf',
        bucketName: 'test',
        createdByUserId: worker.id,
        isActive: true,
      }),
    );
    await command(worker, 'SUBMIT');
    await docs.updateTaskDocument(task, doc.id, worker, {}, {
      originalname: 'new.pdf',
      mimetype: 'application/pdf',
      size: 4,
      buffer: Buffer.from('test'),
    } as any);
    await docs.deleteAttachment(task, doc.id, old.id, worker);
    const history = await workflow.history(
      project.id,
      task.id,
      item.id,
      asActor(worker),
      {},
    );
    expect(history.items[0].evidence[0].attachmentId).toBe(old.id);
    expect(history.items[0].evidence[0].snapshot.originalName).toBe(
      'drawing.pdf',
    );
    expect(history.items[0].evidence[0].fileAvailable).toBe(false);
    await expect(
      docs.getAttachmentContent(task, doc.id, old.id),
    ).rejects.toMatchObject({ status: 410 });
    await expect(
      db.manager.delete(TaskDocumentAttachment, { id: old.id }),
    ).rejects.toThrow();
  });
  it('advisory scheduling does not block submission', async () => {
    const previous = await makeItem(task);
    await db.manager.update(
      TaskChecklistItem,
      { id: item.id },
      { earliestStartDate: '2099-01-01' },
    );
    await db.manager.save(
      ChecklistDependency,
      db.manager.create(ChecklistDependency, {
        checklistItemId: item.id,
        dependsOnChecklistItemId: previous.id,
      }),
    );
    const result = await command(worker, 'SUBMIT');
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        'BEFORE_PLANNED_START',
        'PREDECESSOR_INCOMPLETE',
      ]),
    );
  });
  it('hidden tasks and wrong project URLs stay inaccessible', async () => {
    await expect(command(outsider, 'SUBMIT')).rejects.toThrow('Task not found');
    await request(app.getHttpServer())
      .get(
        `/projects/${randomUUID()}/tasks/${task.id}/checklist/${item.id}/submissions`,
      )
      .set('x-test-user', worker.id)
      .expect(403);
  });
  it('child reportee fallback preserves creator; root removal is rejected', async () => {
    const child = await makeTask(task);
    await db.manager.update(
      Task,
      { id: child.id },
      { reporteeUserId: worker.id, createdByUserId: worker.id },
    );
    const latest = await db.manager.findOneByOrFail(Task, { id: child.id });
    await workflow.removeReportee(project.id, child.id, asActor(reporter), {
      expectedRevision: latest.version,
      idempotencyKey: randomUUID(),
    });
    const after = await db.manager.findOneByOrFail(Task, { id: child.id });
    expect(after.reporteeUserId).toBe(reporter.id);
    expect(after.createdByUserId).toBe(worker.id);
    expect(
      await auth.canManageTaskOwnedChecklist(project.id, child.id, worker.id),
    ).toBe(false);
    await expect(
      workflow.removeReportee(project.id, task.id, asActor(reporter), {
        expectedRevision: task.version,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow('ROOT_REPORTEE_CANNOT_BE_REMOVED');
  });
  it('branch rollup counts the child once and synchronizes its source', async () => {
    const child = await makeTask(task);
    const childItem = await makeItem(child);
    await db.manager.update(
      TaskChecklistItem,
      { id: item.id },
      { branchedTaskId: child.id, branchStatus: 'branched' as any },
    );
    await db.manager.update(
      TaskChecklistItem,
      { id: childItem.id },
      {
        effectiveStage: S.IN_PROGRESS,
        statusId: statuses.get(S.IN_PROGRESS)!.id,
      },
    );
    await db.transaction(async (tx) => {
      await lockWorkflow(tx, project.id);
      await rollupStatuses(tx, project.id);
    });
    expect((await current()).statusId).toBe(statuses.get(S.IN_PROGRESS)!.id);
    expect(
      (await db.manager.findOneByOrFail(Task, { id: task.id })).statusId,
    ).toBe(statuses.get(S.IN_PROGRESS)!.id);
  });
  it('custom states preserve active stage and Review withdrawal resets to Progress', async () => {
    const custom = await db.manager.save(
      ProjectStatus,
      db.manager.create(ProjectStatus, {
        project,
        projectId: project.id,
        name: 'Blocked',
        key: 'blocked',
        canonicalStage: null,
      }),
    );
    await command(worker, 'MOVE', { statusId: custom.id });
    expect((await current()).effectiveStage).toBe(S.TODO);
    await command(worker, 'SUBMIT');
    await command(worker, 'WITHDRAW', { statusId: custom.id });
    expect((await current()).effectiveStage).toBe(S.IN_PROGRESS);
  });
  it('same Review ordering does not submit again and reused keys reject changed payloads', async () => {
    await command(worker, 'SUBMIT');
    const key = randomUUID();
    const revision = (await current()).version;
    await workflow.execute(project.id, task.id, item.id, asActor(worker), {
      statusId: statuses.get(S.IN_REVIEW)!.id,
      expectedRevision: revision,
      idempotencyKey: key,
    });
    expect(
      await db.manager.count(ChecklistSubmission, {
        where: { checklistItemId: item.id },
      }),
    ).toBe(1);
    await expect(
      workflow.execute(project.id, task.id, item.id, asActor(worker), {
        statusId: statuses.get(S.TODO)!.id,
        expectedRevision: revision,
        idempotencyKey: key,
      }),
    ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  });
  it('completed checklist rejects uploads while its sibling remains unfinished', async () => {
    await makeItem(task);
    const doc: any = await docs.createTaskDocument(task, reporter, {
      name: 'Drawing',
      type: TaskDocumentType.DELIVERABLE,
      checklistItemId: item.id,
    });
    await command(worker, 'SUBMIT');
    await command(reporter, 'ACCEPT');
    await expect(
      docs.updateTaskDocument(task, doc.id, worker, {}, {
        originalname: 'late.pdf',
        mimetype: 'application/pdf',
        size: 4,
        buffer: Buffer.from('test'),
      } as any),
    ).rejects.toThrow('CHECKLIST_DONE_IS_TERMINAL');
  });
  it('project search does not reveal hidden task titles', async () => {
    await db.manager.update(
      Task,
      { id: task.id },
      { title: 'PrivateDrawingUniqueToken' },
    );
    const search = new SearchService(
      db.getRepository(Project),
      db.getRepository(SearchRecentItem),
    );
    const hidden = await search.search(
      { q: 'PrivateDrawingUniqueToken' },
      asActor(outsider),
      { workspaceId: project.workspaceId } as any,
    );
    expect(hidden.items).toHaveLength(0);
    const visible = await search.search(
      { q: 'PrivateDrawingUniqueToken' },
      asActor(worker),
      { workspaceId: project.workspaceId } as any,
    );
    expect(visible.items).toHaveLength(1);
  });
  it('pending migration blocks commands; rollback preview leaves data and activation unchanged', async () => {
    await db.manager.save(TaskWorkflowActivation, {
      projectId: project.id,
      activatedAt: null,
    });
    await expect(command(worker, 'SUBMIT')).rejects.toThrow(
      'WORKFLOW_MIGRATION_REQUIRED',
    );
    await db.manager.update(
      TaskChecklistItem,
      { id: item.id },
      {
        effectiveStage: S.IN_PROGRESS,
        statusId: statuses.get(S.IN_PROGRESS)!.id,
      },
    );
    const tx = db.createQueryRunner();
    await tx.connect();
    await tx.startTransaction();
    try {
      await lockWorkflow(tx.manager, project.id);
      expect((await auditWorkflow(tx.manager, project.id)).issues).toEqual([]);
      await tx.query("SELECT set_config('app.workflow_backfill','on',true)");
      expect(
        (await rollupStatuses(tx.manager, project.id)).changedTasks.map(
          (t) => t.id,
        ),
      ).toContain(task.id);
    } finally {
      await tx.rollbackTransaction();
      await tx.release();
    }
    expect(
      (await db.manager.findOneByOrFail(Task, { id: task.id })).statusId,
    ).toBe(statuses.get(S.TODO)!.id);
    expect(
      (
        await db.manager.findOneByOrFail(TaskWorkflowActivation, {
          projectId: project.id,
        })
      ).activatedAt,
    ).toBeNull();
    await db.transaction(async (tx) => {
      await lockWorkflow(tx, project.id);
      await tx.query("SELECT set_config('app.workflow_backfill','on',true)");
      await rollupStatuses(tx, project.id);
      await tx.update(
        TaskWorkflowActivation,
        { projectId: project.id },
        { activatedAt: new Date() },
      );
    });
    await command(worker, 'SUBMIT');
    expect((await auditWorkflow(db.manager, project.id)).issues).toEqual([]);
  });
  it('reportee offboarding and ambiguous migration are rejected', async () => {
    await expect(
      db.manager.delete(ProjectMembership, {
        projectId: project.id,
        userId: reporter.id,
      }),
    ).rejects.toThrow('REPORTEE_OFFBOARDING_REQUIRES_RESOLUTION');
    await expect(
      db.manager.update(User, { id: reporter.id }, { status: false }),
    ).rejects.toThrow('REPORTEE_OFFBOARDING_REQUIRES_RESOLUTION');
    await db.manager.update(Task, { id: task.id }, { completed: true });
    expect(
      (await auditWorkflow(db.manager, project.id)).issues.map((i) => i.code),
    ).toContain('COMPLETED_TASK_HAS_OPEN_WORK');
  });
  it('populated legacy migration audits Review reset, preserves Done, and repairs reportee keys', async () => {
    const tx = db.createQueryRunner();
    await tx.connect();
    await tx.startTransaction();
    try {
      await tx.query('CREATE SCHEMA workflow_legacy_fixture');
      await tx.query('SET LOCAL search_path TO workflow_legacy_fixture,public');
      await tx.query(
        `CREATE TABLE project_statuses(id uuid,key text,"projectId" uuid,canonical_stage text,"completionPolicy" text,"isActive" boolean)`,
      );
      await tx.query(`CREATE TABLE users(pkid integer,id uuid)`);
      await tx.query(
        `CREATE TABLE tasks(id uuid,"projectId" uuid,"reporteeUserId" uuid,reportee_user_id integer,"createdByUserId" uuid,version int)`,
      );
      await tx.query(
        `CREATE TABLE project_memberships("projectId" uuid,"userId" uuid,status text)`,
      );
      await tx.query(
        `CREATE TABLE task_assignees("taskId" uuid,"userId" uuid,"projectRoleId" uuid)`,
      );
      await tx.query(
        `CREATE TABLE task_checklist_items(id uuid,"taskId" uuid,status_id uuid,effective_stage text,legacy_completion boolean,completed boolean,branched_task_id uuid,version int,assigned_members jsonb,reportee_user_id uuid)`,
      );
      for (const [stage, status] of statuses)
        await tx.query(
          `INSERT INTO project_statuses VALUES($1,$2,$3,NULL,'complete_open',true)`,
          [status.id, stage.toLowerCase(), project.id],
        );
      await tx.query('INSERT INTO users VALUES(1,$1)', [reporter.id]);
      await tx.query('INSERT INTO tasks VALUES($1,$2,NULL,NULL,$3,1)', [
        task.id,
        project.id,
        reporter.id,
      ]);
      await tx.query(`INSERT INTO project_memberships VALUES($1,$2,'ACTIVE')`, [
        project.id,
        reporter.id,
      ]);
      const doneId = randomUUID();
      for (const [id, stage, completed] of [
        [item.id, S.IN_REVIEW, false],
        [doneId, S.DONE, true],
      ] as const)
        await tx.query(
          `INSERT INTO task_checklist_items VALUES($1,$2,$3,NULL,false,$4,NULL,1,'[]',NULL)`,
          [id, task.id, statuses.get(stage)!.id, completed],
        );
      await new ClassifyChecklistWorkflow1790000001000().up(tx);
      const rows = await tx.query(
        'SELECT * FROM task_checklist_items ORDER BY completed',
      );
      expect(rows[0].effective_stage).toBe(S.IN_PROGRESS);
      expect(rows[1].legacy_completion).toBe(true);
      expect(rows[1].completed).toBe(true);
      expect((await tx.query('SELECT * FROM tasks'))[0]).toMatchObject({
        reporteeUserId: reporter.id,
        reportee_user_id: 1,
      });
      expect(
        (
          await tx.query(
            "SELECT * FROM workflow_migration_audit WHERE operation='LEGACY_REVIEW_RETURNED_FOR_RESUBMISSION'",
          )
        ).length,
      ).toBe(1);
    } finally {
      await tx.rollbackTransaction();
      await tx.release();
    }
  });
  it('failed offline events roll back partial writes and replay independent of JSON key order', async () => {
    const sync = new TaskSyncEventsService(
      db.getRepository(TaskSyncEvent),
      db.getRepository(Task),
      {} as any,
      {
        recalculateProjectTaskProgress: jest
          .fn()
          .mockRejectedValue(new Error('simulated calculation failure')),
      } as any,
      auth,
    );
    const event = {
      clientEventId: randomUUID(),
      taskId: task.id,
      type: TaskSyncEventType.TASK_PROGRESS_UPDATED,
      occurredAt: new Date().toISOString(),
      payload: { progress: 50, note: 'Offline' },
    };
    const before = await db.manager.findOneByOrFail(Task, { id: task.id });
    const first = await sync.process(project.id, { events: [event] }, worker);
    expect(first.summary.failed).toBe(1);
    expect(
      (await db.manager.findOneByOrFail(Task, { id: task.id })).progress,
    ).toBe(before.progress);
    const second = await sync.process(
      project.id,
      { events: [{ ...event, payload: { note: 'Offline', progress: 50 } }] },
      worker,
    );
    expect(second.processed[0].duplicate).toBe(true);
  });
});
