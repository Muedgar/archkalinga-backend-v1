import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Brackets, EntityManager, Repository } from 'typeorm';
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

@Injectable()
export class TaskDocumentsService {
  constructor(
    @InjectRepository(TaskDocument)
    private readonly documentRepo: Repository<TaskDocument>,
    @InjectRepository(TaskDocumentAttachment)
    private readonly attachmentRepo: Repository<TaskDocumentAttachment>,
    private readonly activitySvc: TaskActivityService,
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

  async createTaskDocument(
    task: Task,
    actorUser: User,
    dto: CreateTaskDocumentDto,
    file?: UploadableFile,
  ): Promise<TaskDocumentSerializer> {
    if (!file) {
      throw new BadRequestException(INVALID_TASK_DOCUMENT_FILE_REQUIRED);
    }

    const uploadedAttachment = await this.uploadDocumentAttachment(
      task,
      actorUser,
      dto,
      file,
    );

    try {
      return await this.documentRepo.manager.transaction(async (tx) => {
        const document = tx.create(TaskDocument, {
          task,
          createdByUser: actorUser,
          updatedByUser: actorUser,
          ...this.toDocumentValues(dto),
        });
        const saved = await tx.save(document);
        uploadedAttachment.document = saved;
        uploadedAttachment.documentId = saved.id;
        saved.attachments = [await tx.save(uploadedAttachment)];

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
    Object.assign(document, this.toDocumentValues(dto));
    document.updatedByUser = actorUser;
    const uploadedAttachment = file
      ? await this.uploadDocumentAttachment(task, actorUser, dto, file)
      : null;

    try {
      return await this.documentRepo.manager.transaction(async (tx) => {
        const saved = await tx.save(document);

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
        } else if (dto.attachments !== undefined) {
          await tx.delete(TaskDocumentAttachment, { documentId: saved.id });
          const attachments = this.toAttachments(dto.attachments, actorUser);
          attachments.forEach((attachment) => {
            attachment.document = saved;
            attachment.documentId = saved.id;
          });
          saved.attachments = await tx.save(attachments);
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
      (attachment) => attachment.isActive,
    );
    if (activeAttachments.length !== 1) {
      throw new BadRequestException(
        INVALID_TASK_DOCUMENT_SOURCE_ACTIVE_ATTACHMENT,
      );
    }
    const sourceAttachment = activeAttachments[0];

    return this.documentRepo.manager.transaction(async (tx) => {
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
      await tx.remove(document);
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
    await this.getTaskDocumentOrFail(taskId, documentId);
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId, documentId },
    });

    if (!attachment) {
      throw new NotFoundException(TASK_DOCUMENT_ATTACHMENT_NOT_FOUND);
    }

    return {
      downloadUrl:
        (await this.minioSvc.getFileUrl(
          attachment.bucketName,
          attachment.filename,
        )) ?? '',
    };
  }

  private async serialize(
    document: Partial<TaskDocument>,
  ): Promise<TaskDocumentSerializer> {
    const attachments = await Promise.all(
      (document.attachments ?? []).map(async (attachment) => ({
        ...attachment,
        downloadUrl:
          (await this.minioSvc.getFileUrl(
            attachment.bucketName,
            attachment.filename,
          )) ?? null,
      })),
    );

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

  private toDocumentValues(
    dto: CreateTaskDocumentDto | UpdateTaskDocumentDto,
  ): Partial<TaskDocument> {
    const values: Partial<TaskDocument> = {};
    this.assignString(values, 'name', dto.name);
    this.assignString(values, 'description', dto.description);
    if (dto.type !== undefined) values.type = dto.type;
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
