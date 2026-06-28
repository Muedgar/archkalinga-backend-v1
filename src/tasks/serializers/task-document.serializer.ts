import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';
import { TaskDocumentType } from '../entities';

class TaskDocumentUserRelationSerializer extends BaseSerializer {
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() userName: string | null;
  @Expose() email: string;
  @Expose() title: string | null;
}

class TaskDocumentTaskRelationSerializer extends BaseSerializer {
  @Expose() title: string;
  @Expose() wbsCode: string | null;
  @Expose() scheduleType: string | null;
}

class TaskDocumentSourceDocumentRelationSerializer extends BaseSerializer {
  @Expose() name: string;
  @Expose() description: string | null;
  @Expose() type: TaskDocumentType;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

class TaskDocumentSourceAttachmentRelationSerializer extends BaseSerializer {
  @Expose() filename: string;
  @Expose() bucketName: string;
  @Expose() notes: string | null;
  @Expose() isActive: boolean;
  @Expose() declare createdAt: Date;
}

export class TaskDocumentAttachmentSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.documentId ?? obj?.document?.id ?? null)
  documentId: string | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.sourceAttachmentId ?? obj?.sourceAttachment?.id ?? null,
  )
  sourceAttachmentId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.sourceAttachment ?? null)
  @Type(() => TaskDocumentSourceAttachmentRelationSerializer)
  sourceAttachment: TaskDocumentSourceAttachmentRelationSerializer | null;

  @Expose() filename: string;
  @Expose() bucketName: string;
  @Expose() notes: string | null;
  @Expose() isActive: boolean;
  @Expose() declare createdAt: Date;

  @Expose()
  @Transform(
    ({ obj }) => obj?.createdByUserId ?? obj?.createdByUser?.id ?? null,
  )
  createdById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.createdByUser ?? null)
  @Type(() => TaskDocumentUserRelationSerializer)
  createdBy: TaskDocumentUserRelationSerializer | null;

  @Expose() downloadUrl: string | null;
}

export class TaskDocumentSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.taskId ?? obj?.task?.id ?? null)
  taskId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.sourceTaskId ?? obj?.sourceTask?.id ?? null)
  sourceTaskId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.task ?? null)
  @Type(() => TaskDocumentTaskRelationSerializer)
  task: TaskDocumentTaskRelationSerializer | null;

  @Expose()
  @Transform(({ obj }) => obj?.sourceTask ?? null)
  @Type(() => TaskDocumentTaskRelationSerializer)
  sourceTask: TaskDocumentTaskRelationSerializer | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.sourceDocumentId ?? obj?.sourceDocument?.id ?? null,
  )
  sourceDocumentId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.sourceDocument ?? null)
  @Type(() => TaskDocumentSourceDocumentRelationSerializer)
  sourceDocument: TaskDocumentSourceDocumentRelationSerializer | null;

  @Expose()
  @Transform(
    ({ obj }) => obj?.createdByUserId ?? obj?.createdByUser?.id ?? null,
  )
  createdById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.createdByUser ?? null)
  @Type(() => TaskDocumentUserRelationSerializer)
  createdBy: TaskDocumentUserRelationSerializer | null;

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;

  @Expose()
  @Transform(
    ({ obj }) => obj?.updatedByUserId ?? obj?.updatedByUser?.id ?? null,
  )
  updatedById: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.updatedByUser ?? null)
  @Type(() => TaskDocumentUserRelationSerializer)
  updatedBy: TaskDocumentUserRelationSerializer | null;

  @Expose() name: string;
  @Expose() description: string | null;
  @Expose() type: TaskDocumentType;

  @Expose()
  @Type(() => TaskDocumentAttachmentSerializer)
  attachments: TaskDocumentAttachmentSerializer[];
}
