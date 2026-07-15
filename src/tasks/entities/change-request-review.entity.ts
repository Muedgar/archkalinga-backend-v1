import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { ChangeRequest } from './change-request.entity';

export enum ChangeRequestReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED_FOR_REVISION = 'RETURNED_FOR_REVISION',
}

@Entity('change_request_reviews')
@Index('idx_change_request_reviews_change_request', ['changeRequestId'])
@Index('idx_change_request_reviews_reviewer_status', [
  'reviewerUserId',
  'status',
])
@Index('idx_change_request_reviews_assigned_by', ['assignedByUserId'])
export class ChangeRequestReview extends AppBaseEntity {
  @ManyToOne(() => ChangeRequest, (changeRequest) => changeRequest.reviews, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'change_request_id', referencedColumnName: 'id' })
  changeRequest: ChangeRequest;

  @Column({ name: 'change_request_id', type: 'uuid', nullable: false })
  changeRequestId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reviewer_user_id', referencedColumnName: 'id' })
  reviewerUser: User;

  @Column({ name: 'reviewer_user_id', type: 'uuid', nullable: false })
  reviewerUserId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assigned_by_user_id', referencedColumnName: 'id' })
  assignedByUser: User;

  @Column({ name: 'assigned_by_user_id', type: 'uuid', nullable: false })
  assignedByUserId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  role: string | null;

  @Column({
    type: 'enum',
    enum: ChangeRequestReviewStatus,
    enumName: 'change_request_reviews_status_enum',
    nullable: false,
    default: ChangeRequestReviewStatus.PENDING,
  })
  status: ChangeRequestReviewStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'decision_notes', type: 'text', nullable: true })
  decisionNotes: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;
}
