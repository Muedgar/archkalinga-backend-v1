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
import type { UploadableFile } from 'src/common/services';
import { ProjectMembership } from 'src/projects/entities';
import { User } from 'src/users/entities';
import {
  AddChecklistItemDto,
  AddCommentDto,
  AddDependencyDto,
  AddLabelDto,
  AddRelationDto,
  AddWatcherDto,
  ActivityScheduleFiltersDto,
  ActivityScheduleGanttQueryDto,
  ActivityScheduleImportDto,
  BulkUpdateTasksDto,
  CreateStarterFromDeliverableDto,
  CreateChangeRequestDto,
  CreateChangeRequestMessageDto,
  CreateChangeRequestReviewDto,
  DecideChangeRequestReviewDto,
  CreateTaskMaterialDto,
  CreateTaskDocumentDto,
  CreateTaskResourceAllocationDto,
  CreateProjectCalendarExceptionDto,
  CreateChecklistGroupDto,
  CreateTaskDto,
  MaterialsReportFiltersDto,
  MaterialsReportImportDto,
  MoveTaskDto,
  RecalculateActivityScheduleDto,
  ReopenChangeRequestDto,
  ResourceReportFiltersDto,
  ResourceReportImportDto,
  TaskDocumentFiltersDto,
  ChangeRequestFiltersDto,
  TaskMaterialFiltersDto,
  TaskFiltersDto,
  UpdateTaskDocumentDto,
  UpdateTaskMaterialDto,
  UpdateTaskResourceAllocationDto,
  UpdateActivityScheduleDto,
  UpdateProjectCalendarExceptionDto,
  UpdateChecklistGroupDto,
  UpdateChecklistItemDto,
  UpdateCommentDto,
  UpdateDependencyDto,
  UpsertProjectCalendarDto,
  UpdateTaskDto,
  EscalateChangeRequestDto,
  ResolveChangeRequestDto,
  SubmitChangeRequestRevisionDto,
} from './dtos';
import { Task } from './entities';
import { TaskDocumentSerializer } from './serializers';
import {
  ActivityScheduleGanttService,
  ActivityScheduleImportService,
  ActivityScheduleUploadFile,
  ActivityScheduleQueryService,
  ProjectCalendarService,
  ScheduleCalculationService,
  TaskActivityScheduleService,
  TaskActivityService,
  TaskAuthService,
  TaskChecklistService,
  TaskChangeRequestsService,
  TaskCommentsService,
  TaskCrudService,
  TaskDocumentsService,
  TaskMembersService,
  TaskMaterialsReportImportService,
  TaskMaterialsReportService,
  TaskMaterialsService,
  TaskQueryService,
  TaskRankingService,
  TaskRelationsService,
  TaskResourceAllocationService,
  TaskResourceReportImportService,
  TaskResourceReportService,
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
    private readonly activityScheduleGanttSvc: ActivityScheduleGanttService,
    private readonly activityScheduleImportSvc: ActivityScheduleImportService,
    private readonly activityScheduleQuerySvc: ActivityScheduleQueryService,
    private readonly projectCalendarSvc: ProjectCalendarService,
    private readonly scheduleCalculationSvc: ScheduleCalculationService,
    private readonly activityScheduleSvc: TaskActivityScheduleService,
    private readonly activitySvc: TaskActivityService,
    private readonly rankingSvc: TaskRankingService,
    private readonly commentsSvc: TaskCommentsService,
    private readonly changeRequestsSvc: TaskChangeRequestsService,
    private readonly checklistSvc: TaskChecklistService,
    private readonly relationsSvc: TaskRelationsService,
    private readonly membersSvc: TaskMembersService,
    private readonly materialsSvc: TaskMaterialsService,
    private readonly documentsSvc: TaskDocumentsService,
    private readonly materialsReportImportSvc: TaskMaterialsReportImportService,
    private readonly materialsReportSvc: TaskMaterialsReportService,
    private readonly resourceAllocationSvc: TaskResourceAllocationService,
    private readonly resourceReportImportSvc: TaskResourceReportImportService,
    private readonly resourceReportSvc: TaskResourceReportService,
  ) {}

  // ── Convenience: auth (used externally by e.g. ProjectsService) ───────────

  async verifyProjectPermission(
    ...args: Parameters<TaskAuthService['verifyProjectPermission']>
  ) {
    return this.authSvc.verifyProjectPermission(...args);
  }

  // ── Core task CRUD ────────────────────────────────────────────────────────

  async createTask(
    projectId: string,
    dto: CreateTaskDto,
    requestUser: RequestUser,
  ) {
    return this.crudSvc.createTask(projectId, dto, requestUser, (p, id, u, m) =>
      this.getTask(p, id, u, m),
    );
  }

  async updateTask(
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
    requestUser: RequestUser,
  ) {
    return this.crudSvc.updateTask(
      projectId,
      taskId,
      dto,
      requestUser,
      (p, id, u, m) => this.getTask(p, id, u, m),
    );
  }

  async moveTask(
    projectId: string,
    taskId: string,
    dto: MoveTaskDto,
    requestUser: RequestUser,
  ) {
    return this.crudSvc.moveTask(
      projectId,
      taskId,
      dto,
      requestUser,
      (p, id, u, m) => this.getTask(p, id, u, m),
    );
  }

  async bulkUpdateTasks(
    projectId: string,
    dto: BulkUpdateTasksDto,
    requestUser: RequestUser,
  ) {
    return this.crudSvc.bulkUpdateTasks(projectId, dto, requestUser);
  }

  async deleteTask(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    return this.crudSvc.deleteTask(projectId, taskId, requestUser);
  }

  // ── Task retrieval ────────────────────────────────────────────────────────

  async getTask(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ) {
    return this.querySvc.getTask(
      projectId,
      taskId,
      requestUser,
      prefetchedMembership,
    );
  }

  async getProjectTasks(
    projectId: string,
    filters: TaskFiltersDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ) {
    return this.querySvc.getProjectTasks(
      projectId,
      filters,
      requestUser,
      prefetchedMembership,
    );
  }

  async findOneOrFail(taskId: string, projectId: string): Promise<Task> {
    return this.querySvc.findOneOrFail(taskId, projectId);
  }

  // ── Activity schedule ────────────────────────────────────────────────────

  async getProjectActivitySchedule(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.activityScheduleQuerySvc.listProjectSchedule(
      projectId,
      filters,
      requestUser,
    );
  }

  async exportProjectActivitySchedule(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.activityScheduleQuerySvc.exportProjectScheduleWorkbook(
      projectId,
      filters,
      requestUser,
    );
  }

  async getProjectCriticalPath(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.activityScheduleQuerySvc.listCriticalPath(
      projectId,
      filters,
      requestUser,
    );
  }

  async exportProjectCriticalPath(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.activityScheduleQuerySvc.exportCriticalPathWorkbook(
      projectId,
      filters,
      requestUser,
    );
  }

  async getProjectResourceReport(
    projectId: string,
    filters: ResourceReportFiltersDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.resourceReportSvc.listProjectResourceReport(
      projectId,
      filters,
      requestUser,
    );
  }

  async exportProjectResourceReport(
    projectId: string,
    filters: ResourceReportFiltersDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.resourceReportSvc.exportProjectResourceReportWorkbook(
      projectId,
      filters,
      requestUser,
    );
  }

  async importProjectResourceReport(
    projectId: string,
    file: ActivityScheduleUploadFile | undefined,
    dto: ResourceReportImportDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    return this.resourceReportImportSvc.importProjectResourceReport(
      projectId,
      file,
      dto,
    );
  }

  async getProjectMaterialsReport(
    projectId: string,
    filters: MaterialsReportFiltersDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.materialsReportSvc.listProjectMaterialsReport(
      projectId,
      filters,
      requestUser,
    );
  }

  async exportProjectMaterialsReport(
    projectId: string,
    filters: MaterialsReportFiltersDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.materialsReportSvc.exportProjectMaterialsReportWorkbook(
      projectId,
      filters,
      requestUser,
    );
  }

  async importProjectMaterialsReport(
    projectId: string,
    file: ActivityScheduleUploadFile | undefined,
    dto: MaterialsReportImportDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    return this.materialsReportImportSvc.importProjectMaterialsReport(
      projectId,
      file,
      dto,
    );
  }

  async getProjectActivityScheduleGantt(
    projectId: string,
    filters: ActivityScheduleGanttQueryDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.activityScheduleGanttSvc.getGantt(
      projectId,
      filters,
      requestUser,
    );
  }

  async getProjectActivityScheduleProgressTracker(
    projectId: string,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.activityScheduleGanttSvc.getProgressTracker(
      projectId,
      requestUser,
    );
  }

  async getProjectActivityScheduleSummary(
    projectId: string,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.activityScheduleGanttSvc.getSummary(projectId, requestUser);
  }

  async getProjectActivityScheduleChecks(
    projectId: string,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.activityScheduleGanttSvc.getChecks(projectId, requestUser);
  }

  async getProjectActivityScheduleExplanation(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.activityScheduleGanttSvc.getExplanation(projectId, taskId);
  }

  async getProjectCalendar(projectId: string, requestUser: RequestUser) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.projectCalendarSvc.getCalendar(projectId);
  }

  async upsertProjectCalendar(
    projectId: string,
    dto: UpsertProjectCalendarDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const actorUser = await this.actor(requestUser);
    return this.projectCalendarSvc.upsertCalendar(projectId, dto, actorUser);
  }

  async listProjectCalendarExceptions(
    projectId: string,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(projectId, requestUser, 'view');
    return this.projectCalendarSvc.listExceptions(projectId);
  }

  async createProjectCalendarException(
    projectId: string,
    dto: CreateProjectCalendarExceptionDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    return this.projectCalendarSvc.createException(projectId, dto);
  }

  async updateProjectCalendarException(
    projectId: string,
    exceptionId: string,
    dto: UpdateProjectCalendarExceptionDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    return this.projectCalendarSvc.updateException(projectId, exceptionId, dto);
  }

  async deleteProjectCalendarException(
    projectId: string,
    exceptionId: string,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    return this.projectCalendarSvc.deleteException(projectId, exceptionId);
  }

  async getTaskActivitySchedule(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.activityScheduleSvc.getForTask(taskId);
  }

  async updateTaskActivitySchedule(
    projectId: string,
    taskId: string,
    dto: UpdateActivityScheduleDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.activityScheduleSvc.upsertForTask(task, actorUser, dto);
  }

  async listTaskResourceAllocations(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.resourceAllocationSvc.listForTask(taskId);
  }

  async getTaskResourceAllocation(
    projectId: string,
    taskId: string,
    allocationId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.resourceAllocationSvc.getForTask(taskId, allocationId);
  }

  async createTaskResourceAllocation(
    projectId: string,
    taskId: string,
    dto: CreateTaskResourceAllocationDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const task = await this.authSvc.ensureTaskForSubresource(
      projectId,
      taskId,
      {
        requestUser,
        membership,
      },
    );
    return this.resourceAllocationSvc.createForTask(task, dto);
  }

  async updateTaskResourceAllocation(
    projectId: string,
    taskId: string,
    allocationId: string,
    dto: UpdateTaskResourceAllocationDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.resourceAllocationSvc.updateForTask(taskId, allocationId, dto);
  }

  async deleteTaskResourceAllocation(
    projectId: string,
    taskId: string,
    allocationId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.resourceAllocationSvc.deleteForTask(taskId, allocationId);
  }

  async listTaskMaterials(
    projectId: string,
    taskId: string,
    filters: TaskMaterialFiltersDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.materialsSvc.listTaskMaterials(taskId, filters);
  }

  async getTaskMaterial(
    projectId: string,
    taskId: string,
    materialId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.materialsSvc.getTaskMaterial(taskId, materialId);
  }

  async createTaskMaterial(
    projectId: string,
    taskId: string,
    dto: CreateTaskMaterialDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.materialsSvc.createTaskMaterial(task, actorUser, dto);
  }

  async updateTaskMaterial(
    projectId: string,
    taskId: string,
    materialId: string,
    dto: UpdateTaskMaterialDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.materialsSvc.updateTaskMaterial(
      task,
      materialId,
      actorUser,
      dto,
    );
  }

  async deleteTaskMaterial(
    projectId: string,
    taskId: string,
    materialId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.materialsSvc.deleteTaskMaterial(task, materialId, actorUser);
  }

  async listTaskDocuments(
    projectId: string,
    taskId: string,
    filters: TaskDocumentFiltersDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.documentsSvc.listTaskDocuments(taskId, filters);
  }

  async getTaskDocument(
    projectId: string,
    taskId: string,
    documentId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.documentsSvc.getTaskDocument(taskId, documentId);
  }

  async getTaskDocumentAttachmentDownloadUrl(
    projectId: string,
    taskId: string,
    documentId: string,
    attachmentId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.documentsSvc.getTaskDocumentAttachmentDownloadUrl(
      taskId,
      documentId,
      attachmentId,
    );
  }

  async createTaskDocument(
    projectId: string,
    taskId: string,
    dto: CreateTaskDocumentDto,
    requestUser: RequestUser,
    file?: UploadableFile,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.documentsSvc.createTaskDocument(task, actorUser, dto, file);
  }

  async createStarterDocumentFromDeliverable(
    projectId: string,
    taskId: string,
    dto: CreateStarterFromDeliverableDto,
    requestUser: RequestUser,
  ): Promise<TaskDocumentSerializer> {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [targetTask, sourceTask, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.authSvc.ensureTaskForSubresource(projectId, dto.sourceTaskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    const sourceDocument = await this.documentsSvc.getTaskDocumentEntityOrFail(
      sourceTask.id,
      dto.sourceDocumentId,
    );

    return this.documentsSvc.createStarterFromDeliverable(
      targetTask,
      sourceTask,
      sourceDocument,
      actorUser,
      dto,
    );
  }

  async updateTaskDocument(
    projectId: string,
    taskId: string,
    documentId: string,
    dto: UpdateTaskDocumentDto,
    requestUser: RequestUser,
    file?: UploadableFile,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.documentsSvc.updateTaskDocument(
      task,
      documentId,
      actorUser,
      dto,
      file,
    );
  }

  async deleteTaskDocument(
    projectId: string,
    taskId: string,
    documentId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.documentsSvc.deleteTaskDocument(task, documentId, actorUser);
  }

  async recalculateActivitySchedule(
    projectId: string,
    dto: RecalculateActivityScheduleDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    if (dto.triggerTaskId) {
      await this.authSvc.ensureTaskForSubresource(
        projectId,
        dto.triggerTaskId,
        { requestUser, membership },
      );
    }
    return this.scheduleCalculationSvc.recalculateProject(projectId, dto);
  }

  async importActivitySchedule(
    projectId: string,
    file: ActivityScheduleUploadFile | undefined,
    dto: ActivityScheduleImportDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const actorUser = await this.actor(requestUser);
    return this.activityScheduleImportSvc.importProjectSchedule(
      projectId,
      file,
      dto,
      actorUser,
    );
  }

  // ── Helper: load actor user ───────────────────────────────────────────────

  private actor(requestUser: RequestUser) {
    return this.userRepo.findOneOrFail({ where: { id: requestUser.id } });
  }

  // ── Change requests ──────────────────────────────────────────────────────

  async listTaskChangeRequests(
    projectId: string,
    taskId: string,
    filters: ChangeRequestFiltersDto,
    requestUser: RequestUser,
  ) {
    const context = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
      'changeRequestManagement',
    );
    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
      context.project,
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.listTaskChangeRequests(
      task,
      filters,
      actorUser,
      canViewAllProjectTasks,
    );
  }

  async getTaskChangeRequest(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    requestUser: RequestUser,
  ) {
    const context = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
      'changeRequestManagement',
    );
    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
      context.project,
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.getTaskChangeRequest(
      task,
      changeRequestId,
      actorUser,
      canViewAllProjectTasks,
    );
  }

  async createTaskChangeRequest(
    projectId: string,
    taskId: string,
    dto: CreateChangeRequestDto,
    requestUser: RequestUser,
    file?: UploadableFile,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'create',
      'changeRequestManagement',
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.createTaskChangeRequest(
      task,
      actorUser,
      dto,
      file,
    );
  }

  async addTaskChangeRequestMessage(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    dto: CreateChangeRequestMessageDto,
    requestUser: RequestUser,
    file?: UploadableFile,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
      'changeRequestManagement',
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.addTaskChangeRequestMessage(
      task,
      changeRequestId,
      actorUser,
      dto,
      file,
    );
  }

  async assignTaskChangeRequestReview(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    dto: CreateChangeRequestReviewDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
      'changeRequestManagement',
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.assignTaskChangeRequestReview(
      task,
      changeRequestId,
      actorUser,
      dto,
    );
  }

  async decideTaskChangeRequestReview(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    reviewId: string,
    dto: DecideChangeRequestReviewDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
      'changeRequestManagement',
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.decideTaskChangeRequestReview(
      task,
      changeRequestId,
      reviewId,
      actorUser,
      dto,
    );
  }

  async submitTaskChangeRequestRevision(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    dto: SubmitChangeRequestRevisionDto,
    requestUser: RequestUser,
    file?: UploadableFile,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
      'changeRequestManagement',
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.submitTaskChangeRequestRevision(
      task,
      changeRequestId,
      actorUser,
      dto,
      file,
    );
  }

  async reopenTaskChangeRequest(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    dto: ReopenChangeRequestDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
      'changeRequestManagement',
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.reopenTaskChangeRequest(
      task,
      changeRequestId,
      actorUser,
      dto,
    );
  }

  async escalateTaskChangeRequest(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    dto: EscalateChangeRequestDto,
    requestUser: RequestUser,
    file?: UploadableFile,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
      'changeRequestManagement',
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.escalateTaskChangeRequest(
      task,
      changeRequestId,
      actorUser,
      dto,
      file,
    );
  }

  async resolveTaskChangeRequest(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    dto: ResolveChangeRequestDto,
    requestUser: RequestUser,
    file?: UploadableFile,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
      'changeRequestManagement',
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.resolveTaskChangeRequest(
      task,
      changeRequestId,
      actorUser,
      dto,
      file,
    );
  }

  async getTaskChangeRequestAttachmentDownloadUrl(
    projectId: string,
    taskId: string,
    changeRequestId: string,
    messageId: string,
    attachmentId: string,
    requestUser: RequestUser,
  ) {
    const context = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
      'changeRequestManagement',
    );
    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
      context.project,
    );

    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId),
      this.actor(requestUser),
    ]);

    return this.changeRequestsSvc.getTaskChangeRequestAttachmentDownloadUrl(
      task,
      changeRequestId,
      messageId,
      attachmentId,
      actorUser,
      canViewAllProjectTasks,
    );
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async getTaskComments(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.commentsSvc.listComments(taskId);
  }

  async addTaskComment(
    projectId: string,
    taskId: string,
    dto: AddCommentDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'create',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.commentsSvc.addComment(task, actorUser, dto);
  }

  async updateTaskComment(
    projectId: string,
    taskId: string,
    commentId: string,
    dto: UpdateCommentDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.commentsSvc.updateComment(
      task,
      commentId,
      requestUser.id,
      actorUser,
      dto,
    );
  }

  async deleteTaskComment(
    projectId: string,
    taskId: string,
    commentId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'delete',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.commentsSvc.deleteComment(
      task,
      commentId,
      requestUser.id,
      actorUser,
    );
  }

  // ── Checklist items ───────────────────────────────────────────────────────

  async getTaskChecklist(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.checklistSvc.listItems(taskId);
  }

  async addChecklistItem(
    projectId: string,
    taskId: string,
    dto: AddChecklistItemDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.checklistSvc.addItem(task, actorUser, dto);
  }

  async updateChecklistItem(
    projectId: string,
    taskId: string,
    itemId: string,
    dto: UpdateChecklistItemDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.checklistSvc.updateItem(
      task,
      itemId,
      requestUser.id,
      actorUser,
      dto,
    );
  }

  async deleteChecklistItem(
    projectId: string,
    taskId: string,
    itemId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.checklistSvc.deleteItem(task, itemId, actorUser);
  }

  // ── Checklist groups ──────────────────────────────────────────────────────

  async getChecklistGroups(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.checklistSvc.listGroups(taskId);
  }

  async createChecklistGroup(
    projectId: string,
    taskId: string,
    dto: CreateChecklistGroupDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const task = await this.authSvc.ensureTaskForSubresource(projectId, taskId);
    return this.checklistSvc.createGroup(task, dto);
  }

  async updateChecklistGroup(
    projectId: string,
    taskId: string,
    groupId: string,
    dto: UpdateChecklistGroupDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.checklistSvc.updateGroup(taskId, groupId, dto);
  }

  async deleteChecklistGroup(
    projectId: string,
    taskId: string,
    groupId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.checklistSvc.deleteGroup(taskId, groupId);
  }

  // ── Dependencies ──────────────────────────────────────────────────────────

  async getTaskDependencies(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.relationsSvc.listDependencies(taskId);
  }

  async addTaskDependency(
    projectId: string,
    taskId: string,
    dto: AddDependencyDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.relationsSvc.addDependency(task, actorUser, dto, projectId);
  }

  async updateTaskDependency(
    projectId: string,
    taskId: string,
    depId: string,
    dto: UpdateDependencyDto,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.relationsSvc.updateDependency(
      task,
      depId,
      actorUser,
      dto,
      projectId,
    );
  }

  async deleteTaskDependency(
    projectId: string,
    taskId: string,
    depId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const [task, actorUser] = await Promise.all([
      this.authSvc.ensureTaskForSubresource(projectId, taskId, {
        requestUser,
        membership,
      }),
      this.actor(requestUser),
    ]);
    return this.relationsSvc.deleteDependency(task, depId, actorUser);
  }

  // ── Relations ─────────────────────────────────────────────────────────────

  async getTaskRelations(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.relationsSvc.listRelations(taskId);
  }

  async addTaskRelation(
    projectId: string,
    taskId: string,
    dto: AddRelationDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const task = await this.authSvc.ensureTaskForSubresource(projectId, taskId);
    return this.relationsSvc.addRelation(task, dto, projectId);
  }

  async deleteTaskRelation(
    projectId: string,
    taskId: string,
    relationId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.relationsSvc.deleteRelation(taskId, relationId);
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  async getTaskLabels(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.membersSvc.listLabels(taskId);
  }

  async addTaskLabel(
    projectId: string,
    taskId: string,
    dto: AddLabelDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const task = await this.authSvc.ensureTaskForSubresource(projectId, taskId);
    return this.membersSvc.addLabel(task, dto, projectId);
  }

  async removeTaskLabel(
    projectId: string,
    taskId: string,
    taskLabelId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.membersSvc.removeLabel(taskId, taskLabelId);
  }

  // ── Watchers ──────────────────────────────────────────────────────────────

  async getTaskWatchers(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.membersSvc.listWatchers(taskId);
  }

  async addTaskWatcher(
    projectId: string,
    taskId: string,
    dto: AddWatcherDto,
    requestUser: RequestUser,
  ) {
    await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    const task = await this.authSvc.ensureTaskForSubresource(projectId, taskId);
    return this.membersSvc.addWatcher(task, dto, projectId);
  }

  async removeTaskWatcher(
    projectId: string,
    taskId: string,
    watcherId: string,
    requestUser: RequestUser,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'update',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.membersSvc.removeWatcher(taskId, watcherId);
  }

  // ── Activity log ──────────────────────────────────────────────────────────

  async getTaskActivity(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
    page = 1,
    limit = 20,
  ) {
    const { membership } = await this.authSvc.verifyProjectPermission(
      projectId,
      requestUser,
      'view',
    );
    await this.authSvc.ensureTaskForSubresource(projectId, taskId, {
      requestUser,
      membership,
    });
    return this.activitySvc.listForTask(taskId, page, limit);
  }
}
