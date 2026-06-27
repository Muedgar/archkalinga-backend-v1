import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';
import { TaskDocumentType } from '../entities';

export class TaskDocumentAttachmentSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.documentId ?? null)
  documentId: string | null;

  @Expose() filename: string;
  @Expose() bucketName: string;
  @Expose() notes: string | null;
  @Expose() isActive: boolean;
}

export class TaskDocumentSerializer extends BaseSerializer {
  @Expose()
  @Transform(({ obj }) => obj?.taskId ?? null)
  taskId: string | null;

  @Expose()
  @Transform(({ obj }) => obj?.createdByUserId ?? null)
  createdBy: string | null;

  @Expose() declare createdAt: Date;
  @Expose() name: string;
  @Expose() description: string | null;
  @Expose() type: TaskDocumentType;

  @Expose()
  @Type(() => TaskDocumentAttachmentSerializer)
  attachments: TaskDocumentAttachmentSerializer[];
}
