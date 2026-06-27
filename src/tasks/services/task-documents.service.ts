import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Brackets, Repository } from 'typeorm';
import { FilterResponse } from 'src/common/interfaces';
import { MinioService, UploadableFile } from 'src/common/services';
import { User } from 'src/users/entities';
import {
  CreateTaskDocumentDto,
  TaskDocumentAttachmentDto,
  TaskDocumentFiltersDto,
  UpdateTaskDocumentDto,
} from '../dtos';
import {
  Task,
  TaskActionType,
  TaskDocument,
  TaskDocumentAttachment,
} from '../entities';
import {
  INVALID_TASK_DOCUMENT_ATTACHMENTS,
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
      .leftJoinAndSelect('document.attachments', 'attachment')
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

    qb.orderBy('document.createdAt', 'DESC')
      .addOrderBy('attachment.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, count] = await qb.getManyAndCount();

    return {
      items: items.map((item) => this.serialize(item)),
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
    const uploadedAttachment = file
      ? await this.uploadDocumentAttachment(task, dto, file)
      : null;

    try {
      return await this.documentRepo.manager.transaction(async (tx) => {
        const document = tx.create(TaskDocument, {
          task,
          taskId: task.id,
          createdByUser: actorUser,
          createdByUserId: actorUser.id,
          ...this.toDocumentValues(dto),
        });
        const attachments = uploadedAttachment
          ? [uploadedAttachment]
          : this.toAttachments(dto.attachments ?? []);
        attachments.forEach((attachment) => {
          attachment.document = document;
        });
        document.attachments = attachments;

        const saved = await tx.save(document);

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

        return this.serialize(saved);
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

  async updateTaskDocument(
    task: Task,
    documentId: string,
    actorUser: User,
    dto: UpdateTaskDocumentDto,
    file?: UploadableFile,
  ): Promise<TaskDocumentSerializer> {
    const document = await this.getTaskDocumentOrFail(task.id, documentId);
    Object.assign(document, this.toDocumentValues(dto));
    const uploadedAttachment = file
      ? await this.uploadDocumentAttachment(task, dto, file)
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
          const attachments = this.toAttachments(dto.attachments);
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

        return this.serialize(saved);
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
    const document = await this.documentRepo.findOne({
      where: { id: documentId, taskId },
      relations: { attachments: true },
      order: { attachments: { createdAt: 'DESC' } },
    });

    if (!document) throw new NotFoundException(TASK_DOCUMENT_NOT_FOUND);
    return document;
  }

  private serialize(document: Partial<TaskDocument>): TaskDocumentSerializer {
    return plainToInstance(TaskDocumentSerializer, document, {
      excludeExtraneousValues: true,
    });
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
  ): TaskDocumentAttachment[] {
    this.assertSingleActiveAttachment(dtos);

    return dtos.map((dto) =>
      this.attachmentRepo.create({
        filename: dto.filename.trim(),
        bucketName: dto.bucketName.trim(),
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
