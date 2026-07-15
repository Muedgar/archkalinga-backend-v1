import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import {
  Brackets,
  EntityManager,
  In,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { FilterResponse } from 'src/common/interfaces';
import { MinioService, UploadableFile } from 'src/common/services';
import { NotificationType } from 'src/notifications/entities/notification.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { User } from 'src/users/entities';
import {
  ChangeRequestFiltersDto,
  CreateChangeRequestReviewDto,
  CreateChangeRequestDto,
  CreateChangeRequestMessageDto,
  DecideChangeRequestReviewDto,
  EscalateChangeRequestDto,
  ReopenChangeRequestDto,
  ResolveChangeRequestDto,
  SubmitChangeRequestRevisionDto,
} from '../dtos';
import {
  ChangeRequest,
  ChangeRequestAuditAction,
  ChangeRequestAuditEntry,
  ChangeRequestImpactType,
  ChangeRequestMessageAttachment,
  ChangeRequestMessageType,
  ChangeRequestPriority,
  ChangeRequestReview,
  ChangeRequestReviewStatus,
  ChangeRequestStatus,
  ChangeRequestThread,
  ChangeRequestThreadMessage,
  Task,
  TaskActionType,
  TaskDocument,
} from '../entities';
import {
  INVALID_CHANGE_REQUEST_DOCUMENTS,
  INVALID_CHANGE_REQUEST_CLOSED,
  INVALID_CHANGE_REQUEST_ESCALATION_ACTOR,
  INVALID_CHANGE_REQUEST_MESSAGE_EMPTY,
  INVALID_CHANGE_REQUEST_RESOLUTION_ACTOR,
  INVALID_CHANGE_REQUEST_STATUS_TRANSITION,
  INVALID_CHANGE_REQUEST_REVIEW_ACTOR,
  INVALID_CHANGE_REQUEST_REVIEW_CLOSED,
  INVALID_CHANGE_REQUEST_REOPEN_ACTOR,
  INVALID_CHANGE_REQUEST_REVISE_ACTOR,
  TASK_CHANGE_REQUEST_ACCESS_DENIED,
  TASK_CHANGE_REQUEST_ATTACHMENT_NOT_FOUND,
  TASK_CHANGE_REQUEST_NOT_FOUND,
  TASK_CHANGE_REQUEST_REVIEW_NOT_FOUND,
  TASK_CHANGE_REQUEST_THREAD_NOT_FOUND,
  TASK_CHANGE_REQUEST_REVIEWER_NOT_FOUND,
} from '../messages';
import {
  ChangeRequestMessageSerializer,
  ChangeRequestSerializer,
} from '../serializers';
import { TaskActivityService } from './task-activity.service';
import { TaskAuthService } from './task-auth.service';

const CHANGE_REQUEST_TERMINAL_STATUSES = new Set<ChangeRequestStatus>([
  ChangeRequestStatus.APPROVED,
  ChangeRequestStatus.REJECTED,
  ChangeRequestStatus.CANCELLED,
]);

type ChangeRequestBucket<T extends string> = Record<T, number>;

type ChangeRequestListSummary = {
  total: number;
  open: number;
  final: number;
  needsMyAttention: number;
  pendingReviews: number;
  myPendingReviews: number;
  withAffectedDocuments: number;
  withProposedTaskChanges: number;
  byStatus: ChangeRequestBucket<ChangeRequestStatus>;
  byImpactType: Partial<ChangeRequestBucket<ChangeRequestImpactType>>;
  byPriority: Partial<ChangeRequestBucket<ChangeRequestPriority>>;
};

type ChangeRequestListResponse = FilterResponse<ChangeRequestSerializer> & {
  meta: {
    taskId: string;
    projectId: string;
    includeMessages: boolean;
    includeSummary: boolean;
  };
  summary?: ChangeRequestListSummary;
};

const CHANGE_REQUEST_STATUS_TRANSITIONS: Record<
  ChangeRequestStatus,
  readonly ChangeRequestStatus[]
> = {
  [ChangeRequestStatus.NEW]: [
    ChangeRequestStatus.UNDER_REVIEW,
    ChangeRequestStatus.ESCALATED,
    ChangeRequestStatus.APPROVED,
    ChangeRequestStatus.REJECTED,
    ChangeRequestStatus.RETURNED_FOR_REVISION,
    ChangeRequestStatus.CANCELLED,
  ],
  [ChangeRequestStatus.UNDER_REVIEW]: [
    ChangeRequestStatus.ESCALATED,
    ChangeRequestStatus.APPROVED,
    ChangeRequestStatus.REJECTED,
    ChangeRequestStatus.RETURNED_FOR_REVISION,
    ChangeRequestStatus.CANCELLED,
  ],
  [ChangeRequestStatus.ESCALATED]: [
    ChangeRequestStatus.ESCALATED,
    ChangeRequestStatus.APPROVED,
    ChangeRequestStatus.REJECTED,
    ChangeRequestStatus.RETURNED_FOR_REVISION,
    ChangeRequestStatus.CANCELLED,
  ],
  [ChangeRequestStatus.APPROVED]: [ChangeRequestStatus.UNDER_REVIEW],
  [ChangeRequestStatus.REJECTED]: [ChangeRequestStatus.UNDER_REVIEW],
  [ChangeRequestStatus.RETURNED_FOR_REVISION]: [
    ChangeRequestStatus.UNDER_REVIEW,
    ChangeRequestStatus.CANCELLED,
  ],
  [ChangeRequestStatus.CANCELLED]: [ChangeRequestStatus.UNDER_REVIEW],
};

@Injectable()
export class TaskChangeRequestsService {
  constructor(
    @InjectRepository(ChangeRequest)
    private readonly changeRequestRepo: Repository<ChangeRequest>,
    @InjectRepository(ChangeRequestThreadMessage)
    private readonly messageRepo: Repository<ChangeRequestThreadMessage>,
    @InjectRepository(ChangeRequestMessageAttachment)
    private readonly attachmentRepo: Repository<ChangeRequestMessageAttachment>,
    @InjectRepository(ChangeRequestReview)
    private readonly reviewRepo: Repository<ChangeRequestReview>,
    @InjectRepository(TaskDocument)
    private readonly documentRepo: Repository<TaskDocument>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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
  ): Promise<ChangeRequestListResponse> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const qb = this.changeRequestRepo
      .createQueryBuilder('changeRequest')
      .leftJoinAndSelect('changeRequest.task', 'task')
      .leftJoin('task.assignees', 'taskAssignee')
      .leftJoinAndSelect('changeRequest.createdByUser', 'createdByUser')
      .leftJoinAndSelect('changeRequest.escalatedToUser', 'escalatedToUser')
      .leftJoinAndSelect('changeRequest.resolvedByUser', 'resolvedByUser')
      .leftJoinAndSelect('changeRequest.affectedDocuments', 'affectedDocument')
      .leftJoinAndSelect('changeRequest.reviews', 'review')
      .leftJoinAndSelect('review.reviewerUser', 'reviewerUser')
      .leftJoinAndSelect('review.assignedByUser', 'reviewAssignedByUser')
      .leftJoinAndSelect('changeRequest.auditEntries', 'auditEntry')
      .leftJoinAndSelect('auditEntry.actorUser', 'auditActor')
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

    if (filters.impactType) {
      qb.andWhere('changeRequest.impactType = :impactType', {
        impactType: filters.impactType,
      });
    }

    if (filters.priority) {
      qb.andWhere('changeRequest.priority = :priority', {
        priority: filters.priority,
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

    if (filters.reviewerUserId) {
      qb.andWhere('review.reviewerUserId = :reviewerUserId', {
        reviewerUserId: filters.reviewerUserId,
      });
    }

    if (filters.documentId) {
      qb.andWhere('affectedDocument.id = :documentId', {
        documentId: filters.documentId,
      });
    }

    if (filters.hasAffectedDocuments !== undefined) {
      qb.andWhere(
        filters.hasAffectedDocuments
          ? 'affectedDocument.id IS NOT NULL'
          : 'affectedDocument.id IS NULL',
      );
    }

    if (filters.hasProposedTaskChanges !== undefined) {
      qb.andWhere(
        filters.hasProposedTaskChanges
          ? 'changeRequest.proposedTaskChanges IS NOT NULL'
          : 'changeRequest.proposedTaskChanges IS NULL',
      );
    }

    if (filters.needsMyAttention === true) {
      this.applyNeedsMyAttentionScope(qb, requestUser.id);
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

    this.authSvc.applyChangeRequestVisibilityScope(
      qb,
      requestUser,
      canViewAllProjectTasks,
    );

    const summary =
      filters.includeSummary === true
        ? await this.buildListSummary(qb, requestUser.id)
        : undefined;

    qb.orderBy('changeRequest.updatedAt', 'DESC');

    if (filters.includeMessages) {
      qb.addOrderBy('message.createdAt', 'ASC').addOrderBy(
        'messageAttachment.createdAt',
        'ASC',
      );
    }

    qb.addOrderBy('review.createdAt', 'ASC');
    qb.addOrderBy('auditEntry.createdAt', 'ASC');

    qb.skip((page - 1) * limit).take(limit);

    const [items, count] = await qb.getManyAndCount();

    return {
      items: await Promise.all(items.map((item) => this.serialize(item))),
      meta: {
        taskId: task.id,
        projectId: task.projectId,
        includeMessages: filters.includeMessages === true,
        includeSummary: filters.includeSummary === true,
      },
      ...(summary ? { summary } : {}),
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
    this.authSvc.ensureChangeRequestTaskParticipant(task, actorUser);
    this.assertMessageContent(dto.message, file);
    const affectedDocuments = await this.getAffectedDocumentsOrFail(
      task.id,
      dto.affectedDocumentIds,
    );

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
            impactType: dto.impactType || null,
            priority: dto.priority || null,
            reasonCategory: this.cleanNullableString(dto.reasonCategory),
            costImpactAmount: dto.costImpactAmount ?? null,
            scheduleImpactDays: dto.scheduleImpactDays ?? null,
            requestedDueDate: this.cleanNullableString(dto.requestedDueDate),
            proposedTaskChanges: dto.proposedTaskChanges ?? null,
          });
          const savedChangeRequest = await tx.save(changeRequest);
          if (affectedDocuments.length > 0) {
            await tx
              .createQueryBuilder()
              .relation(ChangeRequest, 'affectedDocuments')
              .of(savedChangeRequest)
              .add(affectedDocuments.map((document) => document.id));
          }
          savedChangeRequest.affectedDocuments = affectedDocuments;

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

          await this.logAudit(tx, {
            changeRequest: savedChangeRequest,
            actorUser,
            action: ChangeRequestAuditAction.CREATED,
            fromStatus: null,
            toStatus: ChangeRequestStatus.NEW,
            messageId: message.id,
            metadata: {
              title: savedChangeRequest.title,
              impactType: savedChangeRequest.impactType,
              priority: savedChangeRequest.priority,
              affectedDocumentIds: affectedDocuments.map(
                (document) => document.id,
              ),
              proposedTaskChanges: savedChangeRequest.proposedTaskChanges,
            },
          });

          await this.logActivity(tx, task, actorUser, {
            changeRequestId: savedChangeRequest.id,
            threadId: savedThread.id,
            messageId: message.id,
            operation: 'change_request_created',
            status: ChangeRequestStatus.NEW,
            affectedDocumentIds: affectedDocuments.map(
              (document) => document.id,
            ),
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
    this.assertOpen(changeRequest);

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

  async assignTaskChangeRequestReview(
    task: Task,
    changeRequestId: string,
    actorUser: User,
    dto: CreateChangeRequestReviewDto,
  ): Promise<ChangeRequestSerializer> {
    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.ensureThreadAccess(changeRequest, task, actorUser);
    this.assertOpen(changeRequest);

    const reviewer = await this.userRepo.findOne({
      where: { id: dto.reviewerUserId },
    });
    if (!reviewer) {
      throw new NotFoundException(TASK_CHANGE_REQUEST_REVIEWER_NOT_FOUND);
    }

    const thread = changeRequest.thread;
    if (!thread)
      throw new NotFoundException(TASK_CHANGE_REQUEST_THREAD_NOT_FOUND);

    const result = await this.changeRequestRepo.manager.transaction(
      async (tx) => {
        const fromStatus = changeRequest.status;

        if (changeRequest.status === ChangeRequestStatus.NEW) {
          this.assertCanTransition(
            changeRequest.status,
            ChangeRequestStatus.UNDER_REVIEW,
          );
          changeRequest.status = ChangeRequestStatus.UNDER_REVIEW;
          await tx.save(changeRequest);
        }

        const review = tx.create(ChangeRequestReview, {
          changeRequest,
          changeRequestId: changeRequest.id,
          reviewerUser: reviewer,
          reviewerUserId: reviewer.id,
          assignedByUser: actorUser,
          assignedByUserId: actorUser.id,
          role: this.cleanNullableString(dto.role),
          status: ChangeRequestReviewStatus.PENDING,
          notes: this.cleanNullableString(dto.notes),
          decisionNotes: null,
          decidedAt: null,
        });
        const savedReview = await tx.save(review);

        const message = await this.createMessageInTransaction(tx, {
          changeRequest,
          thread,
          actorUser,
          type: ChangeRequestMessageType.SYSTEM,
          body: dto.notes ?? 'Review requested.',
          uploadedAttachment: null,
          metadata: {
            operation: 'change_request_review_assigned',
            reviewId: savedReview.id,
            reviewerUserId: reviewer.id,
            role: savedReview.role,
          },
        });

        await this.logAudit(tx, {
          changeRequest,
          actorUser,
          action: ChangeRequestAuditAction.REVIEW_ASSIGNED,
          fromStatus,
          toStatus: changeRequest.status,
          reviewId: savedReview.id,
          messageId: message.id,
          metadata: {
            reviewerUserId: reviewer.id,
            role: savedReview.role,
          },
        });

        await this.logActivity(tx, task, actorUser, {
          changeRequestId,
          threadId: thread.id,
          messageId: message.id,
          reviewId: savedReview.id,
          reviewerUserId: reviewer.id,
          operation: 'change_request_review_assigned',
          fromStatus,
          toStatus: changeRequest.status,
        });

        return this.serialize(
          await this.reloadChangeRequestForResponse(tx, changeRequest),
        );
      },
    );

    this.notifyChangeRequestReviewAssigned(task, result, reviewer, actorUser);
    return result;
  }

  async decideTaskChangeRequestReview(
    task: Task,
    changeRequestId: string,
    reviewId: string,
    actorUser: User,
    dto: DecideChangeRequestReviewDto,
  ): Promise<ChangeRequestSerializer> {
    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.ensureThreadAccess(changeRequest, task, actorUser);
    this.assertOpen(changeRequest);

    const review = await this.reviewRepo.findOne({
      where: {
        id: reviewId,
        changeRequestId,
      },
      relations: {
        reviewerUser: true,
        assignedByUser: true,
      },
    });

    if (!review) {
      throw new NotFoundException(TASK_CHANGE_REQUEST_REVIEW_NOT_FOUND);
    }
    if (review.reviewerUserId !== actorUser.id) {
      throw new ForbiddenException(INVALID_CHANGE_REQUEST_REVIEW_ACTOR);
    }
    if (review.status !== ChangeRequestReviewStatus.PENDING) {
      throw new BadRequestException(INVALID_CHANGE_REQUEST_REVIEW_CLOSED);
    }

    const thread = changeRequest.thread;
    if (!thread)
      throw new NotFoundException(TASK_CHANGE_REQUEST_THREAD_NOT_FOUND);

    const result = await this.changeRequestRepo.manager.transaction(
      async (tx) => {
        review.status = dto.decision;
        review.decisionNotes = this.cleanNullableString(dto.decisionNotes);
        review.decidedAt = new Date();
        await tx.save(review);

        const message = await this.createMessageInTransaction(tx, {
          changeRequest,
          thread,
          actorUser,
          type: ChangeRequestMessageType.SYSTEM,
          body: dto.decisionNotes ?? `Review decision: ${dto.decision}`,
          uploadedAttachment: null,
          metadata: {
            operation: 'change_request_review_decided',
            reviewId: review.id,
            decision: dto.decision,
          },
        });

        await this.logAudit(tx, {
          changeRequest,
          actorUser,
          action: ChangeRequestAuditAction.REVIEW_DECIDED,
          fromStatus: changeRequest.status,
          toStatus: changeRequest.status,
          reviewId: review.id,
          messageId: message.id,
          metadata: {
            decision: dto.decision,
          },
        });

        await this.logActivity(tx, task, actorUser, {
          changeRequestId,
          threadId: thread.id,
          messageId: message.id,
          reviewId: review.id,
          reviewerUserId: actorUser.id,
          operation: 'change_request_review_decided',
          decision: dto.decision,
        });

        return this.serialize(
          await this.reloadChangeRequestForResponse(tx, changeRequest),
        );
      },
    );

    this.notifyChangeRequestReviewDecided(task, result, review, actorUser);
    return result;
  }

  async submitTaskChangeRequestRevision(
    task: Task,
    changeRequestId: string,
    actorUser: User,
    dto: SubmitChangeRequestRevisionDto,
    file?: UploadableFile,
  ): Promise<ChangeRequestSerializer> {
    this.assertMessageContent(dto.message, file);
    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.ensureThreadAccess(changeRequest, task, actorUser);
    if (!this.canSubmitRevision(changeRequest, task, actorUser)) {
      throw new ForbiddenException(INVALID_CHANGE_REQUEST_REVISE_ACTOR);
    }
    if (changeRequest.status !== ChangeRequestStatus.RETURNED_FOR_REVISION) {
      throw new BadRequestException(INVALID_CHANGE_REQUEST_STATUS_TRANSITION);
    }
    this.assertCanTransition(
      changeRequest.status,
      ChangeRequestStatus.UNDER_REVIEW,
    );

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
          changeRequest.status = ChangeRequestStatus.UNDER_REVIEW;
          changeRequest.resolvedByUserId = null;
          changeRequest.resolvedAt = null;
          await tx.save(changeRequest);

          const message = await this.createMessageInTransaction(tx, {
            changeRequest,
            thread,
            actorUser,
            type: ChangeRequestMessageType.MESSAGE,
            body: dto.message,
            uploadedAttachment,
            metadata: {
              operation: 'change_request_revision_submitted',
            },
          });

          await this.logAudit(tx, {
            changeRequest,
            actorUser,
            action: ChangeRequestAuditAction.REVISION_SUBMITTED,
            fromStatus,
            toStatus: ChangeRequestStatus.UNDER_REVIEW,
            messageId: message.id,
          });

          await this.logActivity(tx, task, actorUser, {
            changeRequestId,
            threadId: thread.id,
            messageId: message.id,
            operation: 'change_request_revision_submitted',
            fromStatus,
            toStatus: ChangeRequestStatus.UNDER_REVIEW,
          });

          return this.serialize(
            await this.reloadChangeRequestForResponse(tx, changeRequest),
          );
        },
      );

      this.notifyChangeRequestRevisionSubmitted(task, result, actorUser);
      return result;
    } catch (error) {
      await this.deleteUploadedAttachment(uploadedAttachment);
      throw error;
    }
  }

  async reopenTaskChangeRequest(
    task: Task,
    changeRequestId: string,
    actorUser: User,
    dto: ReopenChangeRequestDto,
  ): Promise<ChangeRequestSerializer> {
    if (!this.authSvc.canResolveChangeRequest(task, actorUser)) {
      throw new ForbiddenException(INVALID_CHANGE_REQUEST_REOPEN_ACTOR);
    }

    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.assertCanTransition(
      changeRequest.status,
      ChangeRequestStatus.UNDER_REVIEW,
    );

    const thread = changeRequest.thread;
    if (!thread)
      throw new NotFoundException(TASK_CHANGE_REQUEST_THREAD_NOT_FOUND);

    const result = await this.changeRequestRepo.manager.transaction(
      async (tx) => {
        const fromStatus = changeRequest.status;
        changeRequest.status = ChangeRequestStatus.UNDER_REVIEW;
        changeRequest.resolvedByUserId = null;
        changeRequest.resolvedAt = null;
        await tx.save(changeRequest);

        const message = await this.createMessageInTransaction(tx, {
          changeRequest,
          thread,
          actorUser,
          type: ChangeRequestMessageType.SYSTEM,
          body: dto.reason,
          uploadedAttachment: null,
          metadata: {
            operation: 'change_request_reopened',
          },
        });

        await this.logAudit(tx, {
          changeRequest,
          actorUser,
          action: ChangeRequestAuditAction.REOPENED,
          fromStatus,
          toStatus: ChangeRequestStatus.UNDER_REVIEW,
          messageId: message.id,
          metadata: {
            reason: dto.reason,
          },
        });

        await this.logActivity(tx, task, actorUser, {
          changeRequestId,
          threadId: thread.id,
          messageId: message.id,
          operation: 'change_request_reopened',
          fromStatus,
          toStatus: ChangeRequestStatus.UNDER_REVIEW,
        });

        return this.serialize(
          await this.reloadChangeRequestForResponse(tx, changeRequest),
        );
      },
    );

    this.notifyChangeRequestReopened(task, result, actorUser);
    return result;
  }

  async escalateTaskChangeRequest(
    task: Task,
    changeRequestId: string,
    actorUser: User,
    dto: EscalateChangeRequestDto,
    file?: UploadableFile,
  ): Promise<ChangeRequestSerializer> {
    if (!this.authSvc.canEscalateChangeRequest(task, actorUser)) {
      throw new ForbiddenException(INVALID_CHANGE_REQUEST_ESCALATION_ACTOR);
    }

    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.assertOpen(changeRequest);
    this.assertCanTransition(
      changeRequest.status,
      ChangeRequestStatus.ESCALATED,
    );

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

          await this.logAudit(tx, {
            changeRequest,
            actorUser,
            action: ChangeRequestAuditAction.ESCALATED,
            fromStatus,
            toStatus: ChangeRequestStatus.ESCALATED,
            messageId: message.id,
            metadata: {
              escalatedToUserId: parentTask.reporteeUserId,
              parentTaskId: parentTask.id,
            },
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
    if (!this.authSvc.canResolveChangeRequest(task, actorUser)) {
      throw new ForbiddenException(INVALID_CHANGE_REQUEST_RESOLUTION_ACTOR);
    }

    const changeRequest = await this.getChangeRequestEntityOrFail(
      task.id,
      changeRequestId,
    );
    this.assertOpen(changeRequest);

    const thread = changeRequest.thread;
    if (!thread)
      throw new NotFoundException(TASK_CHANGE_REQUEST_THREAD_NOT_FOUND);

    const decision = dto.decision ?? ChangeRequestStatus.APPROVED;
    this.assertCanTransition(changeRequest.status, decision);

    const uploadedAttachment = file
      ? await this.uploadMessageAttachment(task, actorUser, dto, file)
      : null;

    try {
      const result = await this.changeRequestRepo.manager.transaction(
        async (tx) => {
          const fromStatus = changeRequest.status;
          changeRequest.status = decision;
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

          await this.logAudit(tx, {
            changeRequest,
            actorUser,
            action: ChangeRequestAuditAction.DECISION_RECORDED,
            fromStatus,
            toStatus: decision,
            messageId: message.id,
            metadata: {
              decision,
            },
          });

          await this.logActivity(tx, task, actorUser, {
            changeRequestId,
            threadId: thread.id,
            messageId: message.id,
            resolvedByUserId: actorUser.id,
            operation: 'change_request_resolved',
            fromStatus,
            toStatus: decision,
            decision,
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
      .leftJoinAndSelect('changeRequest.affectedDocuments', 'affectedDocument')
      .leftJoinAndSelect('changeRequest.reviews', 'review')
      .leftJoinAndSelect('review.reviewerUser', 'reviewerUser')
      .leftJoinAndSelect('review.assignedByUser', 'reviewAssignedByUser')
      .leftJoinAndSelect('changeRequest.auditEntries', 'auditEntry')
      .leftJoinAndSelect('auditEntry.actorUser', 'auditActor')
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
      .addOrderBy('review.createdAt', 'ASC')
      .addOrderBy('auditEntry.createdAt', 'ASC')
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
      metadata?: Record<string, unknown> | null;
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
      metadata: input.metadata ?? null,
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
        affectedDocuments: true,
        reviews: {
          reviewerUser: true,
          assignedByUser: true,
        },
        auditEntries: {
          actorUser: true,
        },
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
        reviews: {
          createdAt: 'ASC',
        },
        auditEntries: {
          createdAt: 'ASC',
        },
      },
    });

    return reloaded ?? changeRequest;
  }

  private async getAffectedDocumentsOrFail(
    taskId: string,
    documentIds: string[] = [],
  ): Promise<TaskDocument[]> {
    if (documentIds.length === 0) return [];

    const documents = await this.documentRepo.find({
      where: {
        id: In(documentIds),
        taskId,
      },
    });

    if (documents.length !== documentIds.length) {
      throw new BadRequestException(INVALID_CHANGE_REQUEST_DOCUMENTS);
    }

    const byId = new Map(documents.map((document) => [document.id, document]));
    return documentIds.map((documentId) => byId.get(documentId)!);
  }

  private applyNeedsMyAttentionScope(
    qb: SelectQueryBuilder<ChangeRequest>,
    userId: string,
  ): void {
    qb.andWhere(
      new Brackets((attentionQb) => {
        attentionQb
          .where(
            'review.reviewerUserId = :attentionUserId AND review.status = :pendingReviewStatus',
            {
              attentionUserId: userId,
              pendingReviewStatus: ChangeRequestReviewStatus.PENDING,
            },
          )
          .orWhere(
            'changeRequest.status = :returnedForRevisionStatus AND (changeRequest.createdByUserId = :attentionUserId OR task.reporteeUserId = :attentionUserId OR taskAssignee.userId = :attentionUserId)',
            {
              attentionUserId: userId,
              returnedForRevisionStatus:
                ChangeRequestStatus.RETURNED_FOR_REVISION,
            },
          )
          .orWhere(
            'changeRequest.status = :escalatedStatus AND changeRequest.escalatedToUserId = :attentionUserId',
            {
              attentionUserId: userId,
              escalatedStatus: ChangeRequestStatus.ESCALATED,
            },
          );
      }),
    );
  }

  private async buildListSummary(
    qb: SelectQueryBuilder<ChangeRequest>,
    userId: string,
  ): Promise<ChangeRequestListSummary> {
    const [total, statusRows, impactRows, priorityRows] = await Promise.all([
      this.countDistinct(qb),
      this.countGrouped(qb, 'changeRequest.status'),
      this.countGrouped(qb, 'changeRequest.impactType'),
      this.countGrouped(qb, 'changeRequest.priority'),
    ]);

    const byStatus = this.emptyStatusBucket();
    for (const row of statusRows) {
      if (row.key) byStatus[row.key as ChangeRequestStatus] = row.count;
    }

    const byImpactType = this.rowsToBucket<ChangeRequestImpactType>(impactRows);
    const byPriority = this.rowsToBucket<ChangeRequestPriority>(priorityRows);

    const final =
      byStatus[ChangeRequestStatus.APPROVED] +
      byStatus[ChangeRequestStatus.REJECTED] +
      byStatus[ChangeRequestStatus.CANCELLED];

    const [
      pendingReviews,
      myPendingReviews,
      withAffectedDocuments,
      withProposedTaskChanges,
      needsMyAttention,
    ] = await Promise.all([
      this.countPendingReviews(qb),
      this.countPendingReviews(qb, userId),
      this.countDistinct(
        qb.clone().andWhere('affectedDocument.id IS NOT NULL'),
      ),
      this.countDistinct(
        qb.clone().andWhere('changeRequest.proposedTaskChanges IS NOT NULL'),
      ),
      this.countNeedsMyAttention(qb, userId),
    ]);

    return {
      total,
      open: total - final,
      final,
      needsMyAttention,
      pendingReviews,
      myPendingReviews,
      withAffectedDocuments,
      withProposedTaskChanges,
      byStatus,
      byImpactType,
      byPriority,
    };
  }

  private async countDistinct(
    qb: SelectQueryBuilder<ChangeRequest>,
  ): Promise<number> {
    const row = await qb
      .clone()
      .select('COUNT(DISTINCT changeRequest.id)', 'count')
      .orderBy()
      .getRawOne<{ count: string }>();

    return Number(row?.count ?? 0);
  }

  private async countGrouped(
    qb: SelectQueryBuilder<ChangeRequest>,
    column: string,
  ): Promise<Array<{ key: string | null; count: number }>> {
    const rows = await qb
      .clone()
      .select(column, 'key')
      .addSelect('COUNT(DISTINCT changeRequest.id)', 'count')
      .groupBy(column)
      .orderBy()
      .getRawMany<{ key: string | null; count: string }>();

    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
    }));
  }

  private async countPendingReviews(
    qb: SelectQueryBuilder<ChangeRequest>,
    reviewerUserId?: string,
  ): Promise<number> {
    const countQb = qb
      .clone()
      .andWhere('review.status = :summaryPendingReviewStatus', {
        summaryPendingReviewStatus: ChangeRequestReviewStatus.PENDING,
      });

    if (reviewerUserId) {
      countQb.andWhere('review.reviewerUserId = :summaryReviewerUserId', {
        summaryReviewerUserId: reviewerUserId,
      });
    }

    return this.countDistinct(countQb);
  }

  private async countNeedsMyAttention(
    qb: SelectQueryBuilder<ChangeRequest>,
    userId: string,
  ): Promise<number> {
    const countQb = qb.clone();
    this.applyNeedsMyAttentionScope(countQb, userId);
    return this.countDistinct(countQb);
  }

  private emptyStatusBucket(): ChangeRequestBucket<ChangeRequestStatus> {
    return Object.values(ChangeRequestStatus).reduce(
      (bucket, status) => ({ ...bucket, [status]: 0 }),
      {} as ChangeRequestBucket<ChangeRequestStatus>,
    );
  }

  private rowsToBucket<T extends string>(
    rows: Array<{ key: string | null; count: number }>,
  ): Partial<ChangeRequestBucket<T>> {
    return rows.reduce<Partial<ChangeRequestBucket<T>>>((bucket, row) => {
      if (!row.key) return bucket;
      bucket[row.key as T] = row.count;
      return bucket;
    }, {});
  }

  private ensureThreadAccess(
    changeRequest: ChangeRequest,
    task: Task,
    requestUser: User,
    canViewAllProjectTasks = false,
  ): void {
    if (canViewAllProjectTasks) return;
    if (this.isAssignedReviewer(changeRequest, requestUser.id)) return;

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

  private isAssignedReviewer(
    changeRequest: ChangeRequest,
    userId: string,
  ): boolean {
    return (changeRequest.reviews ?? []).some(
      (review) => review.reviewerUserId === userId,
    );
  }

  private canSubmitRevision(
    changeRequest: ChangeRequest,
    task: Task,
    actorUser: User,
  ): boolean {
    return (
      changeRequest.createdByUserId === actorUser.id ||
      this.authSvc.canCreateChangeRequest(task, actorUser)
    );
  }

  private assertMessageContent(
    body: string | null | undefined,
    file?: UploadableFile,
  ): void {
    if (!body?.trim() && !file) {
      throw new BadRequestException(INVALID_CHANGE_REQUEST_MESSAGE_EMPTY);
    }
  }

  private assertOpen(changeRequest: ChangeRequest): void {
    if (CHANGE_REQUEST_TERMINAL_STATUSES.has(changeRequest.status)) {
      throw new BadRequestException(INVALID_CHANGE_REQUEST_CLOSED);
    }
  }

  private assertCanTransition(
    fromStatus: ChangeRequestStatus,
    toStatus: ChangeRequestStatus,
  ): void {
    if (!CHANGE_REQUEST_STATUS_TRANSITIONS[fromStatus].includes(toStatus)) {
      throw new BadRequestException(INVALID_CHANGE_REQUEST_STATUS_TRANSITION);
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

  private async logAudit(
    tx: EntityManager,
    input: {
      changeRequest: ChangeRequest;
      actorUser: User;
      action: ChangeRequestAuditAction;
      fromStatus?: ChangeRequestStatus | null;
      toStatus?: ChangeRequestStatus | null;
      reviewId?: string | null;
      messageId?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await tx.save(
      tx.create(ChangeRequestAuditEntry, {
        changeRequest: input.changeRequest,
        changeRequestId: input.changeRequest.id,
        actorUser: input.actorUser,
        actorUserId: input.actorUser.id,
        action: input.action,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        reviewId: input.reviewId ?? null,
        messageId: input.messageId ?? null,
        metadata: input.metadata ?? null,
      }),
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

  private notifyChangeRequestReviewAssigned(
    task: Task,
    changeRequest: ChangeRequestSerializer,
    reviewer: User,
    actorUser: User,
  ): void {
    const recipients = this.uniqueRecipientIds([reviewer.id], actorUser.id);
    this.notifyRecipients(recipients, {
      title: 'Change request review assigned',
      body: `${this.actorName(actorUser)} assigned you a change request review on "${task.title}".`,
      meta: this.notificationMeta(task, changeRequest, {
        event: 'change_request_review_assigned',
        reviewerUserId: reviewer.id,
      }),
    });
  }

  private notifyChangeRequestReviewDecided(
    task: Task,
    changeRequest: ChangeRequestSerializer,
    review: ChangeRequestReview,
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
      title: 'Change request review decision recorded',
      body: `${this.actorName(actorUser)} recorded a review decision on "${task.title}".`,
      meta: this.notificationMeta(task, changeRequest, {
        event: 'change_request_review_decided',
        reviewId: review.id,
        decision: review.status,
      }),
    });
  }

  private notifyChangeRequestRevisionSubmitted(
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
      title: 'Change request revision submitted',
      body: `${this.actorName(actorUser)} submitted a revision on "${task.title}".`,
      meta: this.notificationMeta(task, changeRequest, {
        event: 'change_request_revision_submitted',
      }),
    });
  }

  private notifyChangeRequestReopened(
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
      title: 'Change request reopened',
      body: `${this.actorName(actorUser)} reopened a change request on "${task.title}".`,
      meta: this.notificationMeta(task, changeRequest, {
        event: 'change_request_reopened',
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
      title: 'Change request decision recorded',
      body: `${this.actorName(actorUser)} recorded a decision on "${task.title}".`,
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
