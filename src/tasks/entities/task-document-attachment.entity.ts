import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { TaskDocument } from './task-document.entity';

@Entity('task_document_attachments')
@Index('idx_task_document_attachments_document', ['documentId'])
@Index('idx_task_document_attachments_active', ['documentId', 'isActive'])
@Index('uq_task_document_one_active_attachment', ['documentId'], {
  unique: true,
  where: '"is_active" = true',
})
export class TaskDocumentAttachment extends AppBaseEntity {
  @ManyToOne(() => TaskDocument, (document) => document.attachments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'document_id', referencedColumnName: 'id' })
  document: TaskDocument;

  @Column({ name: 'document_id', type: 'uuid', nullable: false })
  documentId: string;

  @Column({ type: 'varchar', length: 500, nullable: false })
  filename: string;

  @Column({
    name: 'bucket_name',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  bucketName: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({
    name: 'is_active',
    type: 'boolean',
    nullable: false,
    default: true,
  })
  isActive: boolean;
}
