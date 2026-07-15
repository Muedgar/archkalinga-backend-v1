import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { ChangeRequest, ChangeRequestStatus } from './change-request.entity';
import { ChangeRequestReview } from './change-request-review.entity';
import { ChangeRequestThreadMessage } from './change-request-thread-message.entity';

export enum ChangeRequestAuditAction {
  CREATED = 'CREATED',
  REVIEW_ASSIGNED = 'REVIEW_ASSIGNED',
  REVIEW_DECIDED = 'REVIEW_DECIDED',
  ESCALATED = 'ESCALATED',
  REVISION_SUBMITTED = 'REVISION_SUBMITTED',
  REOPENED = 'REOPENED',
  DECISION_RECORDED = 'DECISION_RECORDED',
}

@Entity('change_request_audit_entries')
@Index('idx_change_request_audit_entries_change_request', ['changeRequestId'])
@Index('idx_change_request_audit_entries_actor', ['actorUserId'])
@Index('idx_change_request_audit_entries_action', ['action'])
export class ChangeRequestAuditEntry extends AppBaseEntity {
  @ManyToOne(
    () => ChangeRequest,
    (changeRequest) => changeRequest.auditEntries,
    {
      nullable: false,
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'change_request_id', referencedColumnName: 'id' })
  changeRequest: ChangeRequest;

  @Column({ name: 'change_request_id', type: 'uuid', nullable: false })
  changeRequestId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_user_id', referencedColumnName: 'id' })
  actorUser: User;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: false })
  actorUserId: string;

  @Column({
    type: 'enum',
    enum: ChangeRequestAuditAction,
    enumName: 'change_request_audit_action_enum',
    nullable: false,
  })
  action: ChangeRequestAuditAction;

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: ChangeRequestStatus,
    enumName: 'change_requests_status_enum',
    nullable: true,
  })
  fromStatus: ChangeRequestStatus | null;

  @Column({
    name: 'to_status',
    type: 'enum',
    enum: ChangeRequestStatus,
    enumName: 'change_requests_status_enum',
    nullable: true,
  })
  toStatus: ChangeRequestStatus | null;

  @ManyToOne(() => ChangeRequestReview, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'review_id', referencedColumnName: 'id' })
  review: ChangeRequestReview | null;

  @Column({ name: 'review_id', type: 'uuid', nullable: true })
  reviewId: string | null;

  @ManyToOne(() => ChangeRequestThreadMessage, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'message_id', referencedColumnName: 'id' })
  message: ChangeRequestThreadMessage | null;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
