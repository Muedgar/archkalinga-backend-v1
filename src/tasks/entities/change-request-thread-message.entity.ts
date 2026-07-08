import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { ChangeRequest } from './change-request.entity';
import { ChangeRequestThread } from './change-request-thread.entity';
import { ChangeRequestMessageAttachment } from './change-request-message-attachment.entity';

export enum ChangeRequestMessageType {
  MESSAGE = 'MESSAGE',
  ESCALATION = 'ESCALATION',
  RESOLUTION = 'RESOLUTION',
  SYSTEM = 'SYSTEM',
}

@Entity('change_request_thread_messages')
@Index('idx_change_request_messages_thread_created', ['threadId', 'createdAt'])
@Index('idx_change_request_messages_change_request', ['changeRequestId'])
@Index('idx_change_request_messages_author', ['authorUserId'])
export class ChangeRequestThreadMessage extends AppBaseEntity {
  @ManyToOne(() => ChangeRequestThread, (thread) => thread.messages, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'thread_id', referencedColumnName: 'id' })
  thread: ChangeRequestThread;

  @Column({ name: 'thread_id', type: 'uuid', nullable: false })
  threadId: string;

  @ManyToOne(() => ChangeRequest, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'change_request_id', referencedColumnName: 'id' })
  changeRequest: ChangeRequest;

  @Column({ name: 'change_request_id', type: 'uuid', nullable: false })
  changeRequestId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_user_id', referencedColumnName: 'id' })
  authorUser: User;

  @Column({ name: 'author_user_id', type: 'uuid', nullable: false })
  authorUserId: string;

  @Column({
    type: 'enum',
    enum: ChangeRequestMessageType,
    enumName: 'change_request_messages_type_enum',
    nullable: false,
    default: ChangeRequestMessageType.MESSAGE,
  })
  type: ChangeRequestMessageType;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @OneToMany(
    () => ChangeRequestMessageAttachment,
    (attachment) => attachment.message,
  )
  attachments: ChangeRequestMessageAttachment[];
}
