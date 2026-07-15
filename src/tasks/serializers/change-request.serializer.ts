import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';
import {
  ChangeRequestAuditAction,
  ChangeRequestImpactType,
  ChangeRequestMessageType,
  ChangeRequestPriority,
  ChangeRequestReviewStatus,
  ChangeRequestStatus,
  TaskDocumentType,
} from '../entities';

class ChangeRequestUserRelationSerializer extends BaseSerializer {
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() userName: string | null;
  @Expose() email: string;
  @Expose() title: string | null;

  @Expose()
  @Transform(({ obj }) => {
    const fullName = [obj?.firstName, obj?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    return fullName || obj?.userName || obj?.email || null;
  })
  displayName: string | null;
}

class ChangeRequestTaskRelationSerializer extends BaseSerializer {
  @Expose() title: string;
  @Expose() wbsCode: string | null;
  @Expose() scheduleType: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.parentTaskId ?? obj?.parent?.id ?? null)
  parentTaskId: string | null;
}

class ChangeRequestDocumentRelationSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.taskId ?? obj?.task?.id ?? null)
  taskId: string | null;

  @Expose() name: string;
  @Expose() description: string | null;
  @Expose() type: TaskDocumentType;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

export class ChangeRequestAttachmentSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.messageId ?? obj?.message?.id ?? null)
  messageId: string | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.changeRequestId ?? obj?.changeRequest?.id ?? null,
  )
  changeRequestId: string | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.createdByUserId ?? obj?.createdByUser?.id ?? null,
  )
  createdById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.createdByUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  createdBy: ChangeRequestUserRelationSerializer | null;

  @Expose() originalName: string;
  @Expose() mimeType: string | null;
  @Expose() sizeBytes: string | null;
  @Expose() notes: string | null;
  @Expose() declare createdAt: Date;
  @Expose() downloadUrl: string | null;
}

export class ChangeRequestMessageSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.threadId ?? obj?.thread?.id ?? null)
  threadId: string | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.changeRequestId ?? obj?.changeRequest?.id ?? null,
  )
  changeRequestId: string | null;

  @Expose() type: ChangeRequestMessageType;
  @Expose() body: string | null;
  @Expose() metadata: Record<string, unknown> | null;
  @Expose() declare createdAt: Date;

  @Expose()
  @Transform(({ obj }) => obj?.authorUserId ?? obj?.authorUser?.id ?? null)
  authorId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.authorUserId ?? obj?.authorUser?.id ?? null)
  createdById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.authorUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  author: ChangeRequestUserRelationSerializer | null;

  @Expose()
  @Transform(({ obj }) => obj?.authorUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  createdBy: ChangeRequestUserRelationSerializer | null;

  @Expose()
  @Transform(({ obj }) => obj?.authorUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  createdByUser: ChangeRequestUserRelationSerializer | null;

  @Expose()
  @Transform(({ obj }) => obj?.authorUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  authorUser: ChangeRequestUserRelationSerializer | null;

  @Expose()
  @Type(() => ChangeRequestAttachmentSerializer)
  attachments: ChangeRequestAttachmentSerializer[];
}

export class ChangeRequestThreadSerializer extends BaseSerializer {
  @Expose()
  @Transform(
    ({ obj }) => obj?.changeRequestId ?? obj?.changeRequest?.id ?? null,
  )
  changeRequestId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.taskId ?? obj?.task?.id ?? null)
  taskId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.projectId ?? obj?.project?.id ?? null)
  projectId: string | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.createdByUserId ?? obj?.createdByUser?.id ?? null,
  )
  createdById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.createdByUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  createdBy: ChangeRequestUserRelationSerializer | null;

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;

  @Expose()
  @Type(() => ChangeRequestMessageSerializer)
  messages: ChangeRequestMessageSerializer[];
}

export class ChangeRequestReviewSerializer extends BaseSerializer {
  @Expose()
  @Transform(
    ({ obj }) => obj?.changeRequestId ?? obj?.changeRequest?.id ?? null,
  )
  changeRequestId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.reviewerUserId ?? obj?.reviewerUser?.id ?? null)
  reviewerId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.reviewerUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  reviewer: ChangeRequestUserRelationSerializer | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.assignedByUserId ?? obj?.assignedByUser?.id ?? null,
  )
  assignedById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.assignedByUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  assignedBy: ChangeRequestUserRelationSerializer | null;

  @Expose() role: string | null;
  @Expose() status: ChangeRequestReviewStatus;
  @Expose() notes: string | null;
  @Expose() decisionNotes: string | null;
  @Expose() decidedAt: Date | null;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

export class ChangeRequestAuditEntrySerializer extends BaseSerializer {
  @Expose()
  @Transform(
    ({ obj }) => obj?.changeRequestId ?? obj?.changeRequest?.id ?? null,
  )
  changeRequestId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.actorUserId ?? obj?.actorUser?.id ?? null)
  actorId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.actorUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  actor: ChangeRequestUserRelationSerializer | null;

  @Expose() action: ChangeRequestAuditAction;
  @Expose() fromStatus: ChangeRequestStatus | null;
  @Expose() toStatus: ChangeRequestStatus | null;
  @Expose() reviewId: string | null;
  @Expose() messageId: string | null;
  @Expose() metadata: Record<string, unknown> | null;
  @Expose() declare createdAt: Date;
}

export class ChangeRequestSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.projectId ?? obj?.project?.id ?? null)
  projectId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.taskId ?? obj?.task?.id ?? null)
  taskId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.task ?? null)
  @Type(() => ChangeRequestTaskRelationSerializer)
  task: ChangeRequestTaskRelationSerializer | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.createdByUserId ?? obj?.createdByUser?.id ?? null,
  )
  createdById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.createdByUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  createdBy: ChangeRequestUserRelationSerializer | null;

  @Expose() status: ChangeRequestStatus;
  @Expose() title: string;
  @Expose() description: string | null;
  @Expose() impactType: ChangeRequestImpactType | null;
  @Expose() priority: ChangeRequestPriority | null;
  @Expose() reasonCategory: string | null;
  @Expose() costImpactAmount: number | null;
  @Expose() scheduleImpactDays: number | null;
  @Expose() requestedDueDate: string | null;
  @Expose() proposedTaskChanges: Record<string, unknown> | null;

  @Expose()
  @Transform(
    ({ obj }) =>
      obj?.affectedDocumentIds ??
      (obj?.affectedDocuments ?? []).map((document) => document.id),
  )
  affectedDocumentIds: string[];

  @Expose()
  @Transform(({ obj }) => obj?.affectedDocuments ?? [])
  @Type(() => ChangeRequestDocumentRelationSerializer)
  affectedDocuments: ChangeRequestDocumentRelationSerializer[];

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;

  @Expose()
  @Transform(
    ({ obj }) => obj?.escalatedToUserId ?? obj?.escalatedToUser?.id ?? null,
  )
  escalatedToId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.escalatedToUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  escalatedTo: ChangeRequestUserRelationSerializer | null;

  @Expose() escalatedAt: Date | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.resolvedByUserId ?? obj?.resolvedByUser?.id ?? null,
  )
  resolvedById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.resolvedByUser ?? null)
  @Type(() => ChangeRequestUserRelationSerializer)
  resolvedBy: ChangeRequestUserRelationSerializer | null;

  @Expose() resolvedAt: Date | null;

  @Expose()
  @Type(() => ChangeRequestReviewSerializer)
  reviews: ChangeRequestReviewSerializer[];

  @Expose()
  @Type(() => ChangeRequestAuditEntrySerializer)
  auditEntries: ChangeRequestAuditEntrySerializer[];

  @Expose()
  @Transform(({ obj }) => obj?.thread ?? null)
  @Type(() => ChangeRequestThreadSerializer)
  thread: ChangeRequestThreadSerializer | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.thread?.messages?.length ?? obj?.messageCount ?? 0,
  )
  messageCount: number;

  @Expose()
  @Transform(({ obj }) => {
    if (obj?.latestMessage) return obj.latestMessage;
    const messages = obj?.thread?.messages ?? [];
    return messages.length > 0 ? messages[messages.length - 1] : null;
  })
  @Type(() => ChangeRequestMessageSerializer)
  latestMessage: ChangeRequestMessageSerializer | null;
}
