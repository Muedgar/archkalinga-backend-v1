import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { FilterResponse } from 'src/common/interfaces';
import { MinioService, UploadableFile } from 'src/common/services';
import { NotificationType } from 'src/notifications/entities/notification.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { User } from 'src/users/entities';
import {
  ChangeRequestFiltersDto,
  CreateChangeRequestDto,
  CreateChangeRequestMessageDto,
  EscalateChangeRequestDto,
  ResolveChangeRequestDto,
} from '../dtos';
import {
  ChangeRequest,
  ChangeRequestMessageAttachment,
  ChangeRequestMessageType,
  ChangeRequestStatus,
  ChangeRequestThread,
  ChangeRequestThreadMessage,
  Task,
  TaskActionType,
} from '../entities';
import {
  INVALID_CHANGE_REQUEST_ALREADY_RESOLVED,
  INVALID_CHANGE_REQUEST_ESCALATION_ACTOR,
  INVALID_CHANGE_REQUEST_MESSAGE_EMPTY,
  INVALID_CHANGE_REQUEST_RESOLUTION_ACTOR,
  TASK_CHANGE_REQUEST_ACCESS_DENIED,
  TASK_CHANGE_REQUEST_ATTACHMENT_NOT_FOUND,
  TASK_CHANGE_REQUEST_NOT_FOUND,
  TASK_CHANGE_REQUEST_THREAD_NOT_FOUND,
} from '../messages';
import {
  ChangeRequestMessageSerializer,
  ChangeRequestSerializer,
} from '../serializers';
import { TaskActivityService } from './task-activity.service';
import { TaskAuthService } from './task-auth.service';

// TEMP: testing-only bypass requested while validating the change request UI.
// Restore to false before shipping.
const CHANGE_REQUEST_TESTING_BYPASS_PERMISSIONS = true;

@Injectable()
export class TaskChangeRequestsService {
  constructor(
    @InjectRepository(ChangeRequest)
    private readonly changeRequestRepo: Repository<ChangeRequest>,
    @InjectRepository(ChangeRequestThreadMessage)
    private readonly messageRepo: Repository<ChangeRequestThreadMessage>,
    @InjectRepository(ChangeRequestMessageAttachment)
    private readonly attachmentRepo: Repository<ChangeRequestMessageAttachment>,
    private readonly authSvc: TaskAuthService,
    private readonly activitySvc: TaskActivityService,
    private readonly notificationsSvc: NotificationsService,
    private readonly minioSvc: MinioService,
    private readonly configService: ConfigService,
  ) {}

  async listTaskChangeRequests(
    task: Task,
    filters: ChangeRequestFiltersDto,
    requestUser: User,
    canViewAllProjectTasks = false,
  ): Promise<FilterResponse<ChangeRequestSerializer>> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const qb = this.changeRequestRepo
      .createQueryBuilder('changeRequest')
      .leftJoinAndSelect('changeRequest.task', 'task')
      .leftJoinAndSelect('changeRequest.createdByUser', 'createdByUser')
      .leftJoinAndSelect('changeRequest.escalatedToUser', 'escalatedToUser')
      .leftJoinAndSelect('changeRequest.resolvedByUser', 'resolvedByUser')
      .leftJoinAndSelect('changeRequest.thread', 'thread')
      .where('changeRequest.taskId = :taskId', { taskId: task.id })
      .andWhere('changeRequest.projectId = :projectId', {
        projectId: task.projectId,
      });

    if (filters.includeMessages) {
      qb.leftJoinAndSelect('thread.messages', 'message')
        .leftJoinAndSelect('message.authorUser', 'messageAuthor')
        .leftJoinAndSelect('message.attachments', 'messageAttachment')
        .leftJoinAndSelect(
          'messageAttachment.createdByUser',
          'messageAttachmentCreatedBy',
        );
    }

    if (filters.status) {
      qb.andWhere('changeRequest.status = :status', {
        status: filters.status,
      });
    }

    if (filters.createdByUserId) {
      qb.andWhere('changeRequest.createdByUserId = :createdByUserId', {
        createdByUserId: filters.createdByUserId,
      });
    }

    if (filters.escalatedToUserId) {
      qb.andWhere('changeRequest.escalatedToUserId = :escalatedToUserId', {
        escalatedToUserId: filters.escalatedToUserId,
      });
    }

    if (filters.search) {
      qb.andWhere(
        new Brackets((searchQb) => {
          searchQb
            .where('changeRequest.title ILIKE :search')
            .orWhere('changeRequest.description ILIKE :search');
          if (filters.includeMessages) {
            searchQb.orWhere('message.body ILIKE :search');
          }
        }),
        { search: `%${filters.search}%` },
      );
    }

    if (!CHANGE_REQUEST_TESTING_BYPASS_PERMISSIONS) {
      this.authSvc.applyChangeRequestVisibilityScope(
        qb,
        requestUser,
        canViewAllProjectTasks,
      );
    }

    qb.orderBy('changeRequest.updatedAt', 'DESC');

    if (filters.includeMessages) {
      qb.addOrderBy('message.createdAt', 'ASC').addOrderBy(
        'messageAttachment.createdAt',
        'ASC',
      );
    }

    qb.skip((page - 1) * limit).take(limit);

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

  async getTaskChangeRequest(
    task: Task,
    changeRequestId: string,
    requestUser: User,
    canViewAllProjectTasks = false,
  ): Promise<ChangeRequestSerializer> {
    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );

    this.ensureThreadAccess(
      changeRequest,
      task,
      requestUser,
      canViewAllProjectTasks,
    );

    return this.serialize(changeRequest);
  }

  async createTaskChangeRequest(
    task: Task,
    actorUser: User,
    dto: CreateChangeRequestDto,
    file?: UploadableFile,
  ): Promise<ChangeRequestSerializer> {
    if (!CHANGE_REQUEST_TESTING_BYPASS_PERMISSIONS) {
      this.authSvc.ensureChangeRequestTaskParticipant(task, actorUser);
    }
    this.assertMessageContent(dto.message, file);

    const uploadedAttachment = file
      ? await this.uploadMessageAttachment(task, actorUser, dto, file)
      : null;

    try {
      const result = await this.changeRequestRepo.manager.transaction(
        async (tx) => {
          const changeRequest = tx.create(ChangeRequest, {
            project: task.project,
            projectId: task.projectId,
            task,
            taskId: task.id,
            createdByUser: actorUser,
            createdByUserId: actorUser.id,
            status: ChangeRequestStatus.NEW,
            title: dto.title.trim(),
            description: this.cleanNullableString(dto.description),
          });
          const savedChangeRequest = await tx.save(changeRequest);

          const thread = tx.create(ChangeRequestThread, {
            changeRequest: savedChangeRequest,
            changeRequestId: savedChangeRequest.id,
            task,
            taskId: task.id,
            project: task.project,
            projectId: task.projectId,
            createdByUser: actorUser,
            createdByUserId: actorUser.id,
          });
          const savedThread = await tx.save(thread);

          const message = await this.createMessageInTransaction(tx, {
            changeRequest: savedChangeRequest,
            thread: savedThread,
            actorUser,
            type: ChangeRequestMessageType.MESSAGE,
            body: dto.message,
            uploadedAttachment,
          });

          savedThread.messages = [message];
          savedChangeRequest.thread = savedThread;

          await this.logActivity(tx, task, actorUser, {
            changeRequestId: savedChangeRequest.id,
            threadId: savedThread.id,
            messageId: message.id,
            operation: 'change_request_created',
            status: ChangeRequestStatus.NEW,
          });

          return this.serialize(
            await this.reloadChangeRequestForResponse(tx, savedChangeRequest),
          );
        },
      );

      this.notifyChangeRequestCreated(task, result, actorUser);
      return result;
    } catch (error) {
      await this.deleteUploadedAttachment(uploadedAttachment);
      throw error;
    }
  }

  async addTaskChangeRequestMessage(
    task: Task,
    changeRequestId: string,
    actorUser: User,
    dto: CreateChangeRequestMessageDto,
    file?: UploadableFile,
  ): Promise<ChangeRequestMessageSerializer> {
    this.assertMessageContent(dto.body, file);
    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.ensureThreadAccess(changeRequest, task, actorUser);
    this.assertNotResolved(changeRequest);

    const thread = changeRequest.thread;
    if (!thread)
      throw new NotFoundException(TASK_CHANGE_REQUEST_THREAD_NOT_FOUND);

    const uploadedAttachment = file
      ? await this.uploadMessageAttachment(task, actorUser, dto, file)
      : null;

    try {
      const result = await this.messageRepo.manager.transaction(async (tx) => {
        const message = await this.createMessageInTransaction(tx, {
          changeRequest,
          thread,
          actorUser,
          type: ChangeRequestMessageType.MESSAGE,
          body: dto.body,
          uploadedAttachment,
        });

        await this.logActivity(tx, task, actorUser, {
          changeRequestId,
          threadId: thread.id,
          messageId: message.id,
          operation: 'change_request_message_added',
          status: changeRequest.status,
        });

        return this.serializeMessage(message);
      });

      this.notifyChangeRequestMessageAdded(
        task,
        changeRequest,
        result,
        actorUser,
      );
      return result;
    } catch (error) {
      await this.deleteUploadedAttachment(uploadedAttachment);
      throw error;
    }
  }

  async escalateTaskChangeRequest(
    task: Task,
    changeRequestId: string,
    actorUser: User,
    dto: EscalateChangeRequestDto,
    file?: UploadableFile,
  ): Promise<ChangeRequestSerializer> {
    if (
      !CHANGE_REQUEST_TESTING_BYPASS_PERMISSIONS &&
      !this.authSvc.canEscalateChangeRequest(task, actorUser)
    ) {
      throw new ForbiddenException(INVALID_CHANGE_REQUEST_ESCALATION_ACTOR);
    }

    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.assertNotResolved(changeRequest);

    const thread = changeRequest.thread;
    if (!thread)
      throw new NotFoundException(TASK_CHANGE_REQUEST_THREAD_NOT_FOUND);

    const parentTask = await this.authSvc.ensureParentTaskReportee(task);
    const uploadedAttachment = file
      ? await this.uploadMessageAttachment(task, actorUser, dto, file)
      : null;

    try {
      const result = await this.changeRequestRepo.manager.transaction(
        async (tx) => {
          const fromStatus = changeRequest.status;
          changeRequest.status = ChangeRequestStatus.ESCALATED;
          changeRequest.escalatedToUserId = parentTask.reporteeUserId;
          changeRequest.escalatedAt = new Date();
          await tx.save(changeRequest);

          const message = await this.createMessageInTransaction(tx, {
            changeRequest,
            thread,
            actorUser,
            type: ChangeRequestMessageType.ESCALATION,
            body: dto.message,
            uploadedAttachment,
          });

          await this.logActivity(tx, task, actorUser, {
            changeRequestId,
            threadId: thread.id,
            messageId: message.id,
            escalatedToUserId: parentTask.reporteeUserId,
            parentTaskId: parentTask.id,
            operation: 'change_request_escalated',
            fromStatus,
            toStatus: ChangeRequestStatus.ESCALATED,
          });

          return this.serialize(
            await this.reloadChangeRequestForResponse(tx, changeRequest),
          );
        },
      );

      this.notifyChangeRequestEscalated(task, result, actorUser);
      return result;
    } catch (error) {
      await this.deleteUploadedAttachment(uploadedAttachment);
      throw error;
    }
  }

  async resolveTaskChangeRequest(
    task: Task,
    changeRequestId: string,
    actorUser: User,
    dto: ResolveChangeRequestDto,
    file?: UploadableFile,
  ): Promise<ChangeRequestSerializer> {
    if (
      !CHANGE_REQUEST_TESTING_BYPASS_PERMISSIONS &&
      !this.authSvc.canResolveChangeRequest(task, actorUser)
    ) {
      throw new ForbiddenException(INVALID_CHANGE_REQUEST_RESOLUTION_ACTOR);
    }

    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.assertNotResolved(changeRequest);

    const thread = changeRequest.thread;
    if (!thread)
      throw new NotFoundException(TASK_CHANGE_REQUEST_THREAD_NOT_FOUND);

    const uploadedAttachment = file
      ? await this.uploadMessageAttachment(task, actorUser, dto, file)
      : null;

    try {
      const result = await this.changeRequestRepo.manager.transaction(
        async (tx) => {
          const fromStatus = changeRequest.status;
          changeRequest.status = ChangeRequestStatus.RESOLVED;
          changeRequest.resolvedByUserId = actorUser.id;
          changeRequest.resolvedAt = new Date();
          await tx.save(changeRequest);

          const message = await this.createMessageInTransaction(tx, {
            changeRequest,
            thread,
            actorUser,
            type: ChangeRequestMessageType.RESOLUTION,
            body: dto.resolution,
            uploadedAttachment,
          });

          await this.logActivity(tx, task, actorUser, {
            changeRequestId,
            threadId: thread.id,
            messageId: message.id,
            resolvedByUserId: actorUser.id,
            operation: 'change_request_resolved',
            fromStatus,
            toStatus: ChangeRequestStatus.RESOLVED,
          });

          return this.serialize(
            await this.reloadChangeRequestForResponse(tx, changeRequest),
          );
        },
      );

      this.notifyChangeRequestResolved(task, result, actorUser);
      return result;
    } catch (error) {
      await this.deleteUploadedAttachment(uploadedAttachment);
      throw error;
    }
  }

  async getTaskChangeRequestAttachmentDownloadUrl(
    task: Task,
    changeRequestId: string,
    messageId: string,
    attachmentId: string,
    requestUser: User,
    canViewAllProjectTasks = false,
  ): Promise<{ downloadUrl: string }> {
    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.ensureThreadAccess(
      changeRequest,
      task,
      requestUser,
      canViewAllProjectTasks,
    );

    const attachment = await this.attachmentRepo.findOne({
      where: {
        id: attachmentId,
        messageId,
        changeRequestId,
      },
    });

    if (!attachment) {
      throw new NotFoundException(TASK_CHANGE_REQUEST_ATTACHMENT_NOT_FOUND);
    }

    return {
      downloadUrl:
        (await this.minioSvc.getFileUrl(
          attachment.bucketName,
          attachment.filename,
        )) ?? '',
    };
  }

  async getChangeRequestEntityOrFail(
    taskId: string,
    changeRequestId: string,
  ): Promise<ChangeRequest> {
    const changeRequest = await this.changeRequestRepo
      .createQueryBuilder('changeRequest')
      .leftJoinAndSelect('changeRequest.task', 'task')
      .leftJoinAndSelect('task.assignees', 'taskAssignee')
      .leftJoinAndSelect('changeRequest.createdByUser', 'createdByUser')
      .leftJoinAndSelect('changeRequest.escalatedToUser', 'escalatedToUser')
      .leftJoinAndSelect('changeRequest.resolvedByUser', 'resolvedByUser')
      .leftJoinAndSelect('changeRequest.thread', 'thread')
      .leftJoinAndSelect('thread.createdByUser', 'threadCreatedBy')
      .leftJoinAndSelect('thread.messages', 'message')
      .leftJoinAndSelect('message.authorUser', 'messageAuthor')
      .leftJoinAndSelect('message.attachments', 'attachment')
      .leftJoinAndSelect('attachment.createdByUser', 'attachmentCreatedBy')
      .where('changeRequest.id = :changeRequestId', { changeRequestId })
      .andWhere('changeRequest.taskId = :taskId', { taskId })
      .orderBy('message.createdAt', 'ASC')
      .addOrderBy('attachment.createdAt', 'ASC')
      .getOne();

    if (!changeRequest) {
      throw new NotFoundException(TASK_CHANGE_REQUEST_NOT_FOUND);
    }

    return changeRequest;
  }

  private async createMessageInTransaction(
    tx: EntityManager,
    input: {
      changeRequest: ChangeRequest;
      thread: ChangeRequestThread;
      actorUser: User;
      type: ChangeRequestMessageType;
      body?: string | null;
      uploadedAttachment: ChangeRequestMessageAttachment | null;
    },
  ): Promise<ChangeRequestThreadMessage> {
    const message = tx.create(ChangeRequestThreadMessage, {
      changeRequest: input.changeRequest,
      changeRequestId: input.changeRequest.id,
      thread: input.thread,
      threadId: input.thread.id,
      authorUser: input.actorUser,
      authorUserId: input.actorUser.id,
      type: input.type,
      body: this.cleanNullableString(input.body),
      metadata: null,
    });

    const savedMessage = await tx.save(message);

    if (input.uploadedAttachment) {
      input.uploadedAttachment.message = savedMessage;
      input.uploadedAttachment.messageId = savedMessage.id;
      input.uploadedAttachment.changeRequest = input.changeRequest;
      input.uploadedAttachment.changeRequestId = input.changeRequest.id;
      savedMessage.attachments = [await tx.save(input.uploadedAttachment)];
    } else {
      savedMessage.attachments = [];
    }

    savedMessage.authorUser = input.actorUser;
    return savedMessage;
  }

  private async reloadChangeRequestForResponse(
    tx: EntityManager,
    changeRequest: ChangeRequest,
  ): Promise<ChangeRequest> {
    const reloaded = await tx.findOne(ChangeRequest, {
      where: { id: changeRequest.id },
      relations: {
        task: true,
        createdByUser: true,
        escalatedToUser: true,
        resolvedByUser: true,
        thread: {
          createdByUser: true,
          messages: {
            authorUser: true,
            attachments: {
              createdByUser: true,
            },
          },
        },
      },
      order: {
        thread: {
          messages: {
            createdAt: 'ASC',
            attachments: {
              createdAt: 'ASC',
            },
          },
        },
      },
    });

    return reloaded ?? changeRequest;
  }

  private ensureThreadAccess(
    changeRequest: ChangeRequest,
    task: Task,
    requestUser: User,
    canViewAllProjectTasks = false,
  ): void {
    if (CHANGE_REQUEST_TESTING_BYPASS_PERMISSIONS) return;
    if (canViewAllProjectTasks) return;

    const accessTask = changeRequest.task ?? task;
    if (
      !this.authSvc.canAccessChangeRequest(
        changeRequest,
        accessTask,
        requestUser,
      )
    ) {
      throw new ForbiddenException(TASK_CHANGE_REQUEST_ACCESS_DENIED);
    }
  }

  private assertMessageContent(
    body: string | null | undefined,
    file?: UploadableFile,
  ): void {
    if (!body?.trim() && !file) {
      throw new BadRequestException(INVALID_CHANGE_REQUEST_MESSAGE_EMPTY);
    }
  }

  private assertNotResolved(changeRequest: ChangeRequest): void {
    if (changeRequest.status === ChangeRequestStatus.RESOLVED) {
      throw new BadRequestException(INVALID_CHANGE_REQUEST_ALREADY_RESOLVED);
    }
  }

  private async serialize(
    changeRequest: Partial<ChangeRequest>,
  ): Promise<ChangeRequestSerializer> {
    const thread = changeRequest.thread
      ? {
          ...changeRequest.thread,
          messages: await Promise.all(
            (changeRequest.thread.messages ?? []).map((message) =>
              this.messageWithDownloadUrls(message),
            ),
          ),
        }
      : null;

    return plainToInstance(
      ChangeRequestSerializer,
      {
        ...changeRequest,
        thread,
      },
      { excludeExtraneousValues: true },
    );
  }

  private async serializeMessage(
    message: ChangeRequestThreadMessage,
  ): Promise<ChangeRequestMessageSerializer> {
    return plainToInstance(
      ChangeRequestMessageSerializer,
      await this.messageWithDownloadUrls(message),
      { excludeExtraneousValues: true },
    );
  }

  private async messageWithDownloadUrls(
    message: Partial<ChangeRequestThreadMessage>,
  ): Promise<Record<string, unknown>> {
    const attachments = await Promise.all(
      (message.attachments ?? []).map(async (attachment) => ({
        ...attachment,
        downloadUrl:
          (await this.minioSvc.getFileUrl(
            attachment.bucketName,
            attachment.filename,
          )) ?? null,
      })),
    );

    return {
      ...message,
      attachments,
    };
  }

  private async uploadMessageAttachment(
    task: Task,
    actorUser: User,
    dto:
      | CreateChangeRequestDto
      | CreateChangeRequestMessageDto
      | EscalateChangeRequestDto
      | ResolveChangeRequestDto
      | { attachmentNotes?: string | null },
    file: UploadableFile,
  ): Promise<ChangeRequestMessageAttachment> {
    const uploaded = await this.minioSvc.uploadFile({
      bucketName: this.resolveBucketName(),
      file,
      objectPrefix: `${task.projectId}/${task.id}/change-requests`,
    });

    return this.attachmentRepo.create({
      bucketName: uploaded.bucketName,
      filename: uploaded.fileName,
      originalName: uploaded.originalName,
      mimeType: uploaded.mimeType,
      sizeBytes: String(uploaded.size),
      createdByUser: actorUser,
      createdByUserId: actorUser.id,
      notes: this.cleanNullableString(dto.attachmentNotes),
    });
  }

  private resolveBucketName(): string {
    return (
      this.configService.get<string>('CHANGE_REQUEST_ATTACHMENTS_BUCKET') ||
      'change-request-attachments'
    );
  }

  private cleanNullableString(value?: string | null): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private async deleteUploadedAttachment(
    attachment: ChangeRequestMessageAttachment | null,
  ): Promise<void> {
    if (!attachment) return;
    await this.minioSvc.deleteFile(attachment.bucketName, attachment.filename);
  }

  private async logActivity(
    tx: EntityManager,
    task: Task,
    actorUser: User,
    actionMeta: Record<string, unknown>,
  ): Promise<void> {
    await this.activitySvc.log(
      tx,
      task,
      actorUser,
      TaskActionType.TASK_UPDATED,
      actionMeta,
    );
  }

  private notifyChangeRequestCreated(
    task: Task,
    changeRequest: ChangeRequestSerializer,
    actorUser: User,
  ): void {
    const recipients = this.participantRecipientIds(task, actorUser.id);
    this.notifyRecipients(recipients, {
      title: 'Change request created',
      body: `${this.actorName(actorUser)} created a change request on "${task.title}".`,
      meta: this.notificationMeta(task, changeRequest, {
        event: 'change_request_created',
      }),
    });
  }

  private notifyChangeRequestMessageAdded(
    task: Task,
    changeRequest: ChangeRequest,
    message: ChangeRequestMessageSerializer,
    actorUser: User,
  ): void {
    const recipients = this.changeRequestRecipientIds(
      task,
      changeRequest,
      actorUser.id,
    );
    this.notifyRecipients(recipients, {
      title: 'Change request message added',
      body: `${this.actorName(actorUser)} added a message on "${task.title}".`,
      meta: this.notificationMeta(task, changeRequest, {
        event: 'change_request_message_added',
        messageId: message.id,
      }),
    });
  }

  private notifyChangeRequestEscalated(
    task: Task,
    changeRequest: ChangeRequestSerializer,
    actorUser: User,
  ): void {
    const recipients = this.uniqueRecipientIds(
      [changeRequest.escalatedToId],
      actorUser.id,
    );
    this.notifyRecipients(recipients, {
      title: 'Change request escalated',
      body: `${this.actorName(actorUser)} escalated a change request on "${task.title}".`,
      meta: this.notificationMeta(task, changeRequest, {
        event: 'change_request_escalated',
      }),
    });
  }

  private notifyChangeRequestResolved(
    task: Task,
    changeRequest: ChangeRequestSerializer,
    actorUser: User,
  ): void {
    const recipients = this.changeRequestRecipientIds(
      task,
      {
        createdByUserId: changeRequest.createdById ?? '',
        escalatedToUserId: changeRequest.escalatedToId,
      },
      actorUser.id,
    );
    this.notifyRecipients(recipients, {
      title: 'Change request resolved',
      body: `${this.actorName(actorUser)} resolved a change request on "${task.title}".`,
      meta: this.notificationMeta(task, changeRequest, {
        event: 'change_request_resolved',
      }),
    });
  }

  private notifyRecipients(
    userIds: string[],
    input: {
      title: string;
      body: string;
      meta: Record<string, unknown>;
    },
  ): void {
    for (const userId of userIds) {
      void this.notificationsSvc
        .createNotification({
          userId,
          type: NotificationType.PROJECT_UPDATE,
          title: input.title,
          body: input.body,
          meta: input.meta,
        })
        .catch(() => void 0);
    }
  }

  private participantRecipientIds(task: Task, actorUserId: string): string[] {
    return this.uniqueRecipientIds(
      [
        task.reporteeUserId,
        ...(task.assignees ?? []).map((assignee) => assignee.userId),
      ],
      actorUserId,
    );
  }

  private changeRequestRecipientIds(
    task: Task,
    changeRequest: Pick<ChangeRequest, 'createdByUserId' | 'escalatedToUserId'>,
    actorUserId: string,
  ): string[] {
    return this.uniqueRecipientIds(
      [
        changeRequest.createdByUserId,
        changeRequest.escalatedToUserId,
        task.reporteeUserId,
        ...(task.assignees ?? []).map((assignee) => assignee.userId),
      ],
      actorUserId,
    );
  }

  private uniqueRecipientIds(
    userIds: Array<string | null | undefined>,
    actorUserId: string,
  ): string[] {
    return [
      ...new Set(userIds.filter((id): id is string => Boolean(id))),
    ].filter((id) => id !== actorUserId);
  }

  private notificationMeta(
    task: Task,
    changeRequest: Pick<ChangeRequestSerializer, 'id' | 'status'>,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      projectId: task.projectId,
      taskId: task.id,
      changeRequestId: changeRequest.id,
      status: changeRequest.status,
      ...extra,
    };
  }

  private actorName(actorUser: User): string {
    return (
      [actorUser.firstName, actorUser.lastName].filter(Boolean).join(' ') ||
      actorUser.email
    );
  }
}
