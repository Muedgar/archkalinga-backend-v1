/**
 * TasksService — public API facade.
 *
 * This class owns no business logic. It:
 *   1. Calls verifyProjectPermission / ensureTaskForSubresource (TaskAuthService)
 *   2. Loads the actor User when sub-services need it
 *   3. Delegates to the appropriate focused sub-service
 *
 * Business logic lives in:
 *   services/task-auth.service.ts    — auth, loaders, validation
 *   services/task-crud.service.ts    — createTask / updateTask / moveTask / bulkUpdate / delete
 *   services/task-query.service.ts   — getTask / getProjectTasks / findOneOrFail
 *   services/task-activity.service.ts
 *   services/task-ranking.service.ts
 *   services/task-comments.service.ts
 *   services/task-checklist.service.ts
 *   services/task-relations.service.ts
 *   services/task-members.service.ts
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { ProjectMembership } from 'src/projects/entities';
import { User } from 'src/users/entities';
import {
  AddChecklistItemDto,
  AddCommentDto,
  AddDependencyDto,
  AddLabelDto,
  AddRelationDto,
  AddWatcherDto,
  BulkUpdateTasksDto,
  CreateChecklistGroupDto,
  CreateTaskDto,
  MoveTaskDto,
  TaskFiltersDto,
  UpdateChecklistGroupDto,
  UpdateChecklistItemDto,
  UpdateCommentDto,
  UpdateTaskDto,
} from './dtos';
import { Task } from './entities';
import {
  TaskActivityService,
  TaskAuthService,
  TaskChecklistService,
  TaskCommentsService,
  TaskCrudService,
  TaskMembersService,
  TaskQueryService,
  TaskRankingService,
  TaskRelationsService,
} from './services';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    // ── Focused sub-services ──────────────────────────────────────────────
    private readonly authSvc: TaskAuthService,
    private readonly crudSvc: TaskCrudService,
    private readonly querySvc: TaskQueryService,
    private readonly activitySvc: TaskActivityService,
    private readonly rankingSvc: TaskRankingService,
    private readonly commentsSvc: TaskCommentsService,
    private readonly checklistSvc: TaskChecklistService,
    private readonly relationsSvc: TaskRelationsService,
    private readonly membersSvc: TaskMembersService,
  ) {}

  // ── Convenience: auth (used externally by e.g. ProjectsService) ───────────

  async verifyProjectPermission(
    ...args: Parameters<TaskAuthService['verifyProjectPermission']>
  ) {
    return this.authSvc.verifyProjectPermission(...args);
  }

  // ── Core task CRUD ────────────────────────────────────────────────────────

  async createTask(projectId: string, dto: CreateTaskDto, requestUser: RequestUser) {
    return this.crudSvc.createTask(projectId, dto, requestUser, (p, id, u, m) => this.getTask(p, id, u, m));
  }

  async updateTask(projectId: string, taskId: string, dto: UpdateTaskDto, requestUser: RequestUser) {
    return this.crudSvc.updateTask(projectId, taskId, dto, requestUser, (p, id, u, m) => this.getTask(p, id, u, m));
  }

  async moveTask(projectId: string, taskId: string, dto: MoveTaskDto, requestUser: RequestUser) {
    return this.crudSvc.moveTask(projectId, taskId, dto, requestUser, (p, id, u, m) => this.getTask(p, id, u, m));
  }

  async bulkUpdateTasks(projectId: string, dto: BulkUpdateTasksDto, requestUser: RequestUser) {
    return this.crudSvc.bulkUpdateTasks(projectId, dto, requestUser);
  }

  async deleteTask(projectId: string, taskId: string, requestUser: RequestUser) {
    return this.crudSvc.deleteTask(projectId, taskId, requestUser);
  }

  // ── Task retrieval ────────────────────────────────────────────────────────

  async getTask(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ) {
    return this.querySvc.getTask(projectId, taskId, requestUser, prefetchedMembership);
  }

  async getProjectTasks(
    projectId: string,
    filters: TaskFiltersDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ) {
    return this.querySvc.getProjectTasks(projectId, filters, requestUser, prefetchedMembership);
  }

  async findOneOrFail(taskId: string, projectId: string): Promise<Task> {
    return this.querySvc.findOneOrFail(taskId, projectId);
  }

  // ── Helper: load actor user ───────────────────────────────────────────────

  private actor(requestUser: RequestUser) {
    return this.userRepo.findOneOrFail({ where: { id: requestUser.id } });
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async getTaskComments(projectId: string, taskId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.commentsSvc.listComments(taskId);
  }

  async addTaskComment(projectId: string, taskId: string, dto: AddCommentDto, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'create');
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership }),
      this.actor(requestUser),
    ]);
    return this.commentsSvc.addComment(task, actorUser, dto);
  }

  async updateTaskComment(projectId: string, taskId: string, commentId: string, dto: UpdateCommentDto, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership }),
      this.actor(requestUser),
    ]);
    return this.commentsSvc.updateComment(task, commentId, requestUser.id, actorUser, dto);
  }

  async deleteTaskComment(projectId: string, taskId: string, commentId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'delete');
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership }),
      this.actor(requestUser),
    ]);
    return this.commentsSvc.deleteComment(task, commentId, requestUser.id, actorUser);
  }

  // ── Checklist items ───────────────────────────────────────────────────────

  async getTaskChecklist(projectId: string, taskId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.checklistSvc.listItems(taskId);
  }

  async addChecklistItem(projectId: string, taskId: string, dto: AddChecklistItemDto, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership }),
      this.actor(requestUser),
    ]);
    return this.checklistSvc.addItem(task, actorUser, dto);
  }

  async updateChecklistItem(projectId: string, taskId: string, itemId: string, dto: UpdateChecklistItemDto, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership }),
      this.actor(requestUser),
    ]);
    return this.checklistSvc.updateItem(task, itemId, requestUser.id, actorUser, dto);
  }

  async deleteChecklistItem(projectId: string, taskId: string, itemId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership }),
      this.actor(requestUser),
    ]);
    return this.checklistSvc.deleteItem(task, itemId, actorUser);
  }

  // ── Checklist groups ──────────────────────────────────────────────────────

  async getChecklistGroups(projectId: string, taskId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.checklistSvc.listGroups(taskId);
  }

  async createChecklistGroup(projectId: string, taskId: string, dto: CreateChecklistGroupDto, requestUser: RequestUser) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const task = await this.authSvc.ensureTaskForSubresource(projectId, taskId);
    return this.checklistSvc.createGroup(task, dto);
  }

  async updateChecklistGroup(projectId: string, taskId: string, groupId: string, dto: UpdateChecklistGroupDto, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.checklistSvc.updateGroup(taskId, groupId, dto);
  }

  async deleteChecklistGroup(projectId: string, taskId: string, groupId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.checklistSvc.deleteGroup(taskId, groupId);
  }

  // ── Dependencies ──────────────────────────────────────────────────────────

  async getTaskDependencies(projectId: string, taskId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.relationsSvc.listDependencies(taskId);
  }

  async addTaskDependency(projectId: string, taskId: string, dto: AddDependencyDto, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership }),
      this.actor(requestUser),
    ]);
    return this.relationsSvc.addDependency(task, actorUser, dto, projectId);
  }

  async deleteTaskDependency(projectId: string, taskId: string, depId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership }),
      this.actor(requestUser),
    ]);
    return this.relationsSvc.deleteDependency(task, depId, actorUser);
  }

  // ── Relations ─────────────────────────────────────────────────────────────

  async getTaskRelations(projectId: string, taskId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.relationsSvc.listRelations(taskId);
  }

  async addTaskRelation(projectId: string, taskId: string, dto: AddRelationDto, requestUser: RequestUser) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const task = await this.authSvc.ensureTaskForSubresource(projectId, taskId);
    return this.relationsSvc.addRelation(task, dto, projectId);
  }

  async deleteTaskRelation(projectId: string, taskId: string, relationId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.relationsSvc.deleteRelation(taskId, relationId);
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  async getTaskLabels(projectId: string, taskId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.membersSvc.listLabels(taskId);
  }

  async addTaskLabel(projectId: string, taskId: string, dto: AddLabelDto, requestUser: RequestUser) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const task = await this.authSvc.ensureTaskForSubresource(projectId, taskId);
    return this.membersSvc.addLabel(task, dto, projectId);
  }

  async removeTaskLabel(projectId: string, taskId: string, taskLabelId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.membersSvc.removeLabel(taskId, taskLabelId);
  }

  // ── Watchers ──────────────────────────────────────────────────────────────

  async getTaskWatchers(projectId: string, taskId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.membersSvc.listWatchers(taskId);
  }

  async addTaskWatcher(projectId: string, taskId: string, dto: AddWatcherDto, requestUser: RequestUser) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    const task = await this.authSvc.ensureTaskForSubresource(projectId, taskId);
    return this.membersSvc.addWatcher(task, dto, projectId);
  }

  async removeTaskWatcher(projectId: string, taskId: string, watcherId: string, requestUser: RequestUser) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'update');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.membersSvc.removeWatcher(taskId, watcherId);
  }

  // ── Activity log ──────────────────────────────────────────────────────────

  async getTaskActivity(projectId: string, taskId: string, requestUser: RequestUser, page = 1, limit = 20) {
    const { membership } = await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, { requestUser, membership });
    return this.activitySvc.listForTask(taskId, page, limit);
  }
}
