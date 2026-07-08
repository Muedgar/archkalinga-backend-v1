import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { ChangeRequest } from './change-request.entity';
import { ChangeRequestThreadMessage } from './change-request-thread-message.entity';

@Entity('change_request_message_attachments')
@Index('idx_change_request_attachments_message', ['messageId'])
@Index('idx_change_request_attachments_change_request', ['changeRequestId'])
@Index('idx_change_request_attachments_created_by', ['createdByUserId'])
export class ChangeRequestMessageAttachment extends AppBaseEntity {
  @ManyToOne(
    () => ChangeRequestThreadMessage,
    (message) => message.attachments,
    {
      nullable: false,
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'message_id', referencedColumnName: 'id' })
  message: ChangeRequestThreadMessage;

  @Column({ name: 'message_id', type: 'uuid', nullable: false })
  messageId: string;

  @ManyToOne(() => ChangeRequest, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'change_request_id', referencedColumnName: 'id' })
  changeRequest: ChangeRequest;

  @Column({ name: 'change_request_id', type: 'uuid', nullable: false })
  changeRequestId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id', referencedColumnName: 'id' })
  createdByUser: User;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: false })
  createdByUserId: string;

  @Column({
    name: 'bucket_name',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  bucketName: string;

  @Column({ type: 'varchar', length: 512, nullable: false })
  filename: string;

  @Column({
    name: 'original_name',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  originalName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 255, nullable: true })
  mimeType: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
