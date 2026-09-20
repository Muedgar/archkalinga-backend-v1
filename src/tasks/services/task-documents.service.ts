import { lockWorkflow } from '../workflow/workflow-domain';
import {
  BadRequestException,
  GoneException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Brackets, EntityManager, In, IsNull, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { FilterResponse } from 'src/common/interfaces';
import { MinioService, UploadableFile } from 'src/common/services';
import { User } from 'src/users/entities';
import {
  CreateTaskDocumentDto,
  CreateStarterFromDeliverableDto,
  TaskDocumentAttachmentDto,
  TaskDocumentFiltersDto,
  UpdateTaskDocumentDto,
} from '../dtos';
import {
  Task,
  TaskActionType,
  TaskDocument,
  TaskDocumentAttachment,
  TaskDocumentType,
  TaskChecklistItem,
  TaskDocumentRevision,
} from '../entities';
import {
  INVALID_TASK_DOCUMENT_ATTACHMENTS,
  INVALID_TASK_DOCUMENT_FILE_REQUIRED,
  INVALID_TASK_DOCUMENT_SOURCE_ACTIVE_ATTACHMENT,
  INVALID_TASK_DOCUMENT_SOURCE_SELF,
  INVALID_TASK_DOCUMENT_SOURCE_TYPE,
  TASK_DOCUMENT_ATTACHMENT_NOT_FOUND,
  TASK_DOCUMENT_NOT_FOUND,
} from '../messages';
import { TaskDocumentSerializer } from '../serializers';
import { TaskActivityService } from './task-activity.service';
import { TaskAuthService } from './task-auth.service';

@Injectable()
export class TaskDocumentsService {
  constructor(
    @InjectRepository(TaskDocument)
    private readonly documentRepo: Repository<TaskDocument>,
    @InjectRepository(TaskDocumentAttachment)
    private readonly attachmentRepo: Repository<TaskDocumentAttachment>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly activitySvc: TaskActivityService,
    private readonly authSvc: TaskAuthService,
    private readonly minioSvc: MinioService,
    private readonly configService: ConfigService,
  ) {}

  async listTaskDocuments(
    taskId: string,
    filters: TaskDocumentFiltersDto,
  ): Promise<FilterResponse<TaskDocumentSerializer>> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;
    const qb = this.documentRepo
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.task', 'task')
      .leftJoinAndSelect('document.sourceTask', 'sourceTask')
      .leftJoinAndSelect('document.sourceDocument', 'sourceDocument')
      .leftJoinAndSelect('document.createdByUser', 'createdByUser')
      .leftJoinAndSelect('document.updatedByUser', 'updatedByUser')
      .leftJoinAndSelect('document.attachments', 'attachment')
      .leftJoinAndSelect('attachment.createdByUser', 'attachmentCreatedByUser')
      .leftJoinAndSelect('attachment.sourceAttachment', 'sourceAttachment')
      .where('document.taskId = :taskId', { taskId });

    if (filters.scope === 'TASK')
      qb.andWhere('document.checklistItemId IS NULL');
    if (filters.scope === 'CHECKLIST')
      qb.andWhere('document.checklistItemId IS NOT NULL');
    if (filters.checklistItemId)
      qb.andWhere('document.checklistItemId = :checklistItemId', {
        checklistItemId: filters.checklistItemId,
      });
    if (filters.type) {
      qb.andWhere('document.type = :type', { type: filters.type });
    }

    if (filters.name) {
      qb.andWhere('document.name ILIKE :name', { name: `%${filters.name}%` });
    }

    if (filters.search) {
      qb.andWhere(
        new Brackets((searchQb) => {
          searchQb
            .where('document.name ILIKE :search')
            .orWhere('document.description ILIKE :search')
            .orWhere('attachment.filename ILIKE :search')
            .orWhere('attachment.notes ILIKE :search');
        }),
        { search: `%${filters.search}%` },
      );
    }

    qb.orderBy('document.updatedAt', 'DESC')
      .addOrderBy('attachment.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, count] = await qb.getManyAndCount();

    return {
      items: await Promise.all(items.map((item) => this.serialize(item))),
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async getTaskDocument(
    taskId: string,
    documentId: string,
  ): Promise<TaskDocumentSerializer> {
    return this.serialize(await this.getTaskDocumentOrFail(taskId, documentId));
  }

  async listTaskSubtreeDeliverableDocuments(
    projectId: string,
    rootTaskId: string,
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
  ): Promise<TaskDocumentSerializer[]> {
    const taskIds = await this.loadSubtreeTaskIds(projectId, rootTaskId);

    const qb = this.documentRepo
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.task', 'task')
      .leftJoinAndSelect('document.sourceTask', 'sourceTask')
      .leftJoinAndSelect('document.sourceDocument', 'sourceDocument')
      .leftJoinAndSelect('document.createdByUser', 'createdByUser')
      .leftJoinAndSelect('document.updatedByUser', 'updatedByUser')
      .leftJoinAndSelect('document.attachments', 'attachment')
      .leftJoinAndSelect('attachment.createdByUser', 'attachmentCreatedByUser')
      .leftJoinAndSelect('attachment.sourceAttachment', 'sourceAttachment')
      .where('document.taskId IN (:...taskIds)', { taskIds })
      .andWhere('document.type = :type', {
        type: TaskDocumentType.DELIVERABLE,
      })
      .andWhere('task.deletedAt IS NULL')
      .andWhere('task.supersededByTaskId IS NULL')
      .orderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
      .addOrderBy('task.rank', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC')
      .addOrderBy('document.updatedAt', 'DESC')
      .addOrderBy('attachment.createdAt', 'DESC');

    this.authSvc.applyTaskVisibilityScope(
      qb,
      requestUser,
      canViewAllProjectTasks,
    );

    const documents = await qb.getMany();
    return Promise.all(documents.map((document) => this.serialize(document)));
  }

  async createTaskDocument(
    task: Task,
    actorUser: User,
    dto: CreateTaskDocumentDto,
    file?: UploadableFile,
  ): Promise<TaskDocumentSerializer> {
    if (!file && dto.type !== TaskDocumentType.DELIVERABLE) {
      throw new BadRequestException(INVALID_TASK_DOCUMENT_FILE_REQUIRED);
    }

    const uploadedAttachment = file
      ? await this.uploadDocumentAttachment(task, actorUser, dto, file)
      : null;

    try {
      return await this.documentRepo.manager.transaction(async (tx) => {
        await lockWorkflow(tx, task.projectId);
        await this.authorizeWrite(tx, task, actorUser, dto.type, !file);
        await this.validateScope(tx, task.id, dto.checklistItemId, dto.type);
        if (file) await this.assertUploadOpen(tx, task.id, dto.checklistItemId);
        if (dto.attachments !== undefined)
          throw new BadRequestException(
            'Use file uploads, not storage references',
          );
        const document = tx.create(TaskDocument, {
          task,
          createdByUser: actorUser,
          updatedByUser: actorUser,
          ...this.toDocumentValues(dto),
        });
        const saved = await tx.save(document);
        if (uploadedAttachment) {
          uploadedAttachment.document = saved;
          uploadedAttachment.documentId = saved.id;
          saved.attachments = [await tx.save(uploadedAttachment)];
        }

        await this.activitySvc.log(
          tx,
          task,
          actorUser,
          TaskActionType.TASK_UPDATED,
          {
            documentId: saved.id,
            documentType: saved.type,
            operation: 'task_document_created',
          },
        );

        return this.serialize(await this.reloadDocumentForResponse(tx, saved));
      });
    } catch (error) {
      if (uploadedAttachment)
        await this.minioSvc.deleteFile(
          uploadedAttachment.bucketName,
          uploadedAttachment.filename,
        );
      throw error;
    }
  }

  async updateTaskDocument(
    task: Task,
    documentId: string,
    actorUser: User,
    dto: UpdateTaskDocumentDto,
    file?: UploadableFile,
  ): Promise<TaskDocumentSerializer> {
    const document = await this.getTaskDocumentOrFail(task.id, documentId);
    if (document.deletedAt)
      throw new GoneException({ code: 'FILE_CONTENT_DELETED' });
    if (dto.attachments !== undefined)
      throw new BadRequestException(
        'ATTACHMENT_LIST_REPLACEMENT_FORBIDDEN: use upload or delete a version',
      );
    const uploadedAttachment = file
      ? await this.uploadDocumentAttachment(task, actorUser, dto, file)
      : null;

    try {
      return await this.documentRepo.manager.transaction(async (tx) => {
        await lockWorkflow(tx, task.projectId);
        await this.authorizeWrite(
          tx,
          task,
          actorUser,
          document.type,
          dto.name !== undefined ||
            dto.description !== undefined ||
            dto.type !== undefined,
        );
        const current = await tx.findOneOrFail(TaskDocument, {
          where: { id: documentId, taskId: task.id },
        });
        if (file)
          await this.assertUploadOpen(tx, task.id, current.checklistItemId);
        if (current.deletedAt)
          throw new GoneException({ code: 'FILE_CONTENT_DELETED' });
        await this.validateScope(
          tx,
          task.id,
          dto.checklistItemId === undefined
            ? current.checklistItemId
            : dto.checklistItemId,
          dto.type ?? current.type,
        );
        if (
          dto.checklistItemId !== undefined &&
          dto.checklistItemId !== current.checklistItemId
        )
          throw new ConflictException('DOCUMENT_SCOPE_IS_IMMUTABLE');
        await tx.save(
          TaskDocumentRevision,
          tx.create(TaskDocumentRevision, {
            documentId,
            actorUserId: actorUser.id,
            snapshot: {
              name: current.name,
              description: current.description,
              type: current.type,
              version: current.version,
            },
          }),
        );
        Object.assign(current, this.toDocumentValues(dto));
        current.updatedByUserId = actorUser.id;
        const saved = await tx.save(current);

        if (uploadedAttachment) {
          await tx.update(
            TaskDocumentAttachment,
            { documentId: saved.id, isActive: true },
            { isActive: false },
          );
          uploadedAttachment.document = saved;
          uploadedAttachment.documentId = saved.id;
          await tx.save(uploadedAttachment);
          saved.attachments = await tx.find(TaskDocumentAttachment, {
            where: { documentId: saved.id },
            order: { createdAt: 'DESC' },
          });
        }

        await this.activitySvc.log(
          tx,
          task,
          actorUser,
          TaskActionType.TASK_UPDATED,
          {
            documentId: saved.id,
            documentType: saved.type,
            operation: uploadedAttachment
              ? 'task_document_file_uploaded'
              : 'task_document_updated',
          },
        );

        return this.serialize(await this.reloadDocumentForResponse(tx, saved));
      });
    } catch (error) {
      if (uploadedAttachment) {
        await this.minioSvc.deleteFile(
          uploadedAttachment.bucketName,
          uploadedAttachment.filename,
        );
      }
      throw error;
    }
  }

  async createStarterFromDeliverable(
    targetTask: Task,
    sourceTask: Task,
    sourceDocument: TaskDocument,
    actorUser: User,
    dto: CreateStarterFromDeliverableDto,
  ): Promise<TaskDocumentSerializer> {
    if (targetTask.id === sourceTask.id) {
      throw new BadRequestException(INVALID_TASK_DOCUMENT_SOURCE_SELF);
    }

    if (sourceDocument.type !== TaskDocumentType.DELIVERABLE) {
      throw new BadRequestException(INVALID_TASK_DOCUMENT_SOURCE_TYPE);
    }

    const activeAttachments = (sourceDocument.attachments ?? []).filter(
      (attachment) => attachment.isActive && !attachment.deletedAt,
    );
    if (activeAttachments.length !== 1) {
      throw new BadRequestException(
        INVALID_TASK_DOCUMENT_SOURCE_ACTIVE_ATTACHMENT,
      );
    }
    const sourceAttachment = activeAttachments[0];

    return this.documentRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, targetTask.projectId);
      await this.authorizeWrite(
        tx,
        targetTask,
        actorUser,
        TaskDocumentType.STARTER,
        true,
      );
      const currentSource = await tx.findOneOrFail(TaskDocument, {
        where: { id: sourceDocument.id },
      });
      const currentAttachment = await tx.findOneOrFail(TaskDocumentAttachment, {
        where: { id: sourceAttachment.id },
      });
      if (currentSource.deletedAt || currentAttachment.deletedAt)
        throw new GoneException({ code: 'FILE_CONTENT_DELETED' });
      const document = tx.create(TaskDocument, {
        task: targetTask,
        sourceTask,
        sourceDocument,
        createdByUser: actorUser,
        updatedByUser: actorUser,
        name: dto.name?.trim() || sourceDocument.name,
        description:
          dto.description === undefined
            ? sourceDocument.description
            : dto.description === null
              ? null
              : dto.description.trim(),
        type: TaskDocumentType.STARTER,
      });

      const savedDocument = await tx.save(document);

      const attachment = tx.create(TaskDocumentAttachment, {
        document: savedDocument,
        documentId: savedDocument.id,
        sourceAttachment,
        sourceAttachmentId: sourceAttachment.id,
        createdByUser: actorUser,
        filename: sourceAttachment.filename,
        bucketName: sourceAttachment.bucketName,
        notes:
          dto.attachmentNotes === undefined
            ? sourceAttachment.notes
            : dto.attachmentNotes === null
              ? null
              : dto.attachmentNotes.trim(),
        isActive: true,
      });
      savedDocument.attachments = [await tx.save(attachment)];

      await this.activitySvc.log(
        tx,
        targetTask,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          targetDocumentId: savedDocument.id,
          documentType: savedDocument.type,
          sourceTaskId: sourceTask.id,
          sourceDocumentId: sourceDocument.id,
          sourceAttachmentId: sourceAttachment.id,
          operation: 'task_document_created_from_deliverable',
        },
      );

      return this.serialize(
        await this.reloadDocumentForResponse(tx, savedDocument),
      );
    });
  }

  async deleteTaskDocument(
    task: Task,
    documentId: string,
    actorUser: User,
  ): Promise<{ id: string; success: true }> {
    const document = await this.getTaskDocumentOrFail(task.id, documentId);

    await this.documentRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, task.projectId);
      await this.authorizeWrite(tx, task, actorUser, document.type, true);
      await tx.update(
        TaskDocument,
        { id: document.id },
        { deletedAt: new Date(), deletedByUserId: actorUser.id },
      );
      await tx.update(
        TaskDocumentAttachment,
        { documentId: document.id, deletedAt: IsNull() },
        {
          deletedAt: new Date(),
          deletedByUserId: actorUser.id,
          isActive: false,
        },
      );
      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          documentId,
          documentType: document.type,
          operation: 'task_document_deleted',
        },
      );
    });

    return { id: documentId, success: true };
  }

  async getTaskDocumentOrFail(
    taskId: string,
    documentId: string,
  ): Promise<TaskDocument> {
    return this.getTaskDocumentEntityOrFail(taskId, documentId);
  }

  async getTaskDocumentEntityOrFail(
    taskId: string,
    documentId: string,
  ): Promise<TaskDocument> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId, taskId },
      relations: {
        task: true,
        sourceTask: true,
        sourceDocument: true,
        createdByUser: true,
        updatedByUser: true,
        attachments: {
          createdByUser: true,
          sourceAttachment: true,
        },
      },
      order: { attachments: { createdAt: 'DESC' } },
    });

    if (!document) throw new NotFoundException(TASK_DOCUMENT_NOT_FOUND);
    return document;
  }

  private async reloadDocumentForResponse(
    tx: EntityManager,
    document: TaskDocument,
  ): Promise<TaskDocument> {
    const reloaded = await tx.findOne(TaskDocument, {
      where: { id: document.id },
      relations: {
        task: true,
        sourceTask: true,
        sourceDocument: true,
        createdByUser: true,
        updatedByUser: true,
        attachments: {
          createdByUser: true,
          sourceAttachment: true,
        },
      },
      order: { attachments: { createdAt: 'DESC' } },
    });

    return reloaded ?? document;
  }

  async getTaskDocumentAttachmentDownloadUrl(
    taskId: string,
    documentId: string,
    attachmentId: string,
  ): Promise<{ downloadUrl: string }> {
    const document = await this.getTaskDocumentOrFail(taskId, documentId);
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId, documentId },
    });

    if (!attachment) {
      throw new NotFoundException(TASK_DOCUMENT_ATTACHMENT_NOT_FOUND);
    }

    if (document.deletedAt || attachment.deletedAt)
      throw new GoneException({ code: 'FILE_CONTENT_DELETED' });
    return {
      downloadUrl: this.contentPath(
        document.task.projectId,
        taskId,
        documentId,
        attachmentId,
      ),
    };
  }

  private contentPath(
    projectId: string,
    taskId: string,
    documentId: string,
    attachmentId: string,
  ) {
    return `/projects/${projectId}/tasks/${taskId}/documents/${documentId}/attachments/${attachmentId}/content`;
  }

  async getAttachmentContent(
    task: Task,
    documentId: string,
    attachmentId: string,
  ) {
    // Hold workflow lock until storage read is authorized/completed, serializing deletion.
    return this.documentRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, task.projectId);
      const document = await tx.findOne(TaskDocument, {
        where: { id: documentId, taskId: task.id },
      });
      const file = await tx.findOne(TaskDocumentAttachment, {
        where: { id: attachmentId, documentId },
      });
      if (!document || !file)
        throw new NotFoundException(TASK_DOCUMENT_ATTACHMENT_NOT_FOUND);
      if (document.deletedAt || file.deletedAt)
        throw new GoneException({ code: 'FILE_CONTENT_DELETED' });
      return {
        buffer: await this.minioSvc.getFileContent(
          file.bucketName,
          file.filename,
        ),
        name: file.originalName ?? file.filename,
        mimeType: file.mimeType ?? 'application/octet-stream',
      };
    });
  }

  private async serialize(
    document: Partial<TaskDocument>,
  ): Promise<TaskDocumentSerializer> {
    const owner =
      document.task ??
      (await this.taskRepo.findOneOrFail({ where: { id: document.taskId } }));
    const attachments = (document.attachments ?? []).map((attachment) => ({
      ...attachment,
      fileAvailable: !document.deletedAt && !attachment.deletedAt,
      downloadUrl:
        document.deletedAt || attachment.deletedAt
          ? null
          : this.contentPath(
              owner.projectId,
              owner.id,
              document.id!,
              attachment.id,
            ),
    }));

    return plainToInstance(
      TaskDocumentSerializer,
      {
        ...document,
        attachments,
      },
      {
        excludeExtraneousValues: true,
      },
    );
  }

  private async authorizeWrite(
    tx: EntityManager,
    task: Task,
    actor: User,
    type: TaskDocumentType,
    definition: boolean,
  ) {
    await this.authSvc.verifyProjectPermission(task.projectId, actor, 'view');
    const live = await tx.findOneOrFail(Task, {
      where: { id: task.id, projectId: task.projectId, deletedAt: IsNull() },
      relations: ['assignees'],
    });
    if (live.supersededByTaskId)
      throw new ConflictException('TASK_WORKFLOW_CLOSED');
    const manager = await this.authSvc.canManageTaskOwnedChecklist(
      task.projectId,
      task.id,
      actor.id,
    );
    const assignee = live.assignees.some((a) => a.userId === actor.id);
    if (
      !manager &&
      !(type === TaskDocumentType.DELIVERABLE && assignee && !definition)
    )
      throw new ForbiddenException('DOCUMENT_ACTION_FORBIDDEN');
  }

  private async assertUploadOpen(
    tx: EntityManager,
    taskId: string,
    itemId?: string | null,
  ) {
    const task = await tx.findOneOrFail(Task, { where: { id: taskId } });
    const item = itemId
      ? await tx.findOne(TaskChecklistItem, { where: { id: itemId, taskId } })
      : null;
    if (task.completed || item?.completed)
      throw new ConflictException('CHECKLIST_DONE_IS_TERMINAL');
    if (item?.branchedTaskId)
      throw new ConflictException('BRANCHED_CHECKLIST_IS_READ_ONLY');
  }

  private async validateScope(
    tx: EntityManager,
    taskId: string,
    itemId: string | null | undefined,
    type: TaskDocumentType,
  ) {
    if (type === TaskDocumentType.REFERENCE && itemId)
      throw new BadRequestException('REFERENCE documents belong to tasks');
    if (type === TaskDocumentType.DELIVERABLE && !itemId)
      throw new BadRequestException('Deliverables require checklistItemId');
    if (
      itemId &&
      !(await tx.exists(TaskChecklistItem, { where: { id: itemId, taskId } }))
    )
      throw new BadRequestException('Checklist does not belong to task');
  }

  async listDocumentHistory(taskId: string, documentId: string) {
    await this.getTaskDocumentOrFail(taskId, documentId);
    return this.documentRepo.manager.find(TaskDocumentRevision, {
      where: { documentId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async deleteAttachment(
    task: Task,
    documentId: string,
    attachmentId: string,
    actor: User,
  ) {
    return this.documentRepo.manager.transaction(async (tx) => {
      await lockWorkflow(tx, task.projectId);
      const document = await tx.findOneOrFail(TaskDocument, {
        where: { id: documentId, taskId: task.id },
      });
      await this.authorizeWrite(tx, task, actor, document.type, false);
      const attachment = await tx.findOne(TaskDocumentAttachment, {
        where: { id: attachmentId, documentId },
      });
      if (!attachment)
        throw new NotFoundException(TASK_DOCUMENT_ATTACHMENT_NOT_FOUND);
      attachment.deletedAt ??= new Date();
      attachment.deletedByUserId ??= actor.id;
      attachment.isActive = false;
      await tx.save(attachment);
      await this.activitySvc.log(tx, task, actor, TaskActionType.TASK_UPDATED, {
        operation: 'document_version_deleted',
        documentId,
        attachmentId,
      });
      return { id: attachmentId, deleted: true };
    });
  }

  private async loadSubtreeTaskIds(
    projectId: string,
    rootTaskId: string,
  ): Promise<string[]> {
    const taskIds = [rootTaskId];
    const visitedTaskIds = new Set(taskIds);
    let frontierIds = [rootTaskId];

    while (frontierIds.length > 0) {
      const children = await this.taskRepo.find({
        where: {
          projectId,
          parentTaskId: In(frontierIds),
          deletedAt: IsNull(),
        },
        select: ['id'],
      });
      frontierIds = children
        .map((task) => task.id)
        .filter((id) => !visitedTaskIds.has(id));
      frontierIds.forEach((id) => visitedTaskIds.add(id));
      taskIds.push(...frontierIds);
    }

    return taskIds;
  }

  private toDocumentValues(
    dto: CreateTaskDocumentDto | UpdateTaskDocumentDto,
  ): Partial<TaskDocument> {
    const values: Partial<TaskDocument> = {};
    this.assignString(values, 'name', dto.name);
    this.assignString(values, 'description', dto.description);
    if (dto.type !== undefined) values.type = dto.type;
    if (dto.checklistItemId !== undefined)
      values.checklistItemId = dto.checklistItemId;
    return values;
  }

  private toAttachments(
    dtos: TaskDocumentAttachmentDto[] = [],
    actorUser: User,
  ): TaskDocumentAttachment[] {
    this.assertSingleActiveAttachment(dtos);

    return dtos.map((dto) =>
      this.attachmentRepo.create({
        filename: dto.filename.trim(),
        bucketName: dto.bucketName.trim(),
        createdByUser: actorUser,
        notes:
          dto.notes === undefined || dto.notes === null
            ? null
            : dto.notes.trim(),
        isActive: dto.isActive ?? true,
      }),
    );
  }

  private async uploadDocumentAttachment(
    task: Task,
    actorUser: User,
    dto: CreateTaskDocumentDto | UpdateTaskDocumentDto,
    file: UploadableFile,
  ): Promise<TaskDocumentAttachment> {
    const uploaded = await this.minioSvc.uploadFile({
      bucketName: this.resolveBucketName(dto),
      file,
      objectPrefix: `${task.projectId}/${task.id}`,
    });

    return this.attachmentRepo.create({
      originalName: uploaded.originalName,
      mimeType: uploaded.mimeType,
      sizeBytes: String(uploaded.size),
      filename: uploaded.fileName,
      bucketName: uploaded.bucketName,
      createdByUser: actorUser,
      notes:
        dto.attachmentNotes === undefined || dto.attachmentNotes === null
          ? null
          : dto.attachmentNotes.trim(),
      isActive: true,
    });
  }

  private resolveBucketName(
    dto: CreateTaskDocumentDto | UpdateTaskDocumentDto,
  ): string {
    return (
      dto.bucketName?.trim() ||
      this.configService.get<string>('TASK_DOCUMENTS_BUCKET') ||
      'task-documents'
    );
  }

  private assertSingleActiveAttachment(
    dtos: TaskDocumentAttachmentDto[] = [],
  ): void {
    const activeCount = dtos.filter((dto) => dto.isActive ?? true).length;
    if (activeCount > 1) {
      throw new BadRequestException(INVALID_TASK_DOCUMENT_ATTACHMENTS);
    }
  }

  private assignString<K extends keyof TaskDocument>(
    values: Partial<TaskDocument>,
    key: K,
    value: string | null | undefined,
  ): void {
    if (value === undefined) return;
    values[key] = (value === null ? null : value.trim()) as TaskDocument[K];
  }
}
