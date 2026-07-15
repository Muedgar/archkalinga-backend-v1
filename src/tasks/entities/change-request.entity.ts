import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';
import { ChangeRequestAuditEntry } from './change-request-audit-entry.entity';
import { ChangeRequestReview } from './change-request-review.entity';
import { ChangeRequestThread } from './change-request-thread.entity';
import { TaskDocument } from './task-document.entity';

const numericTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

export enum ChangeRequestStatus {
  NEW = 'NEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ESCALATED = 'ESCALATED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED_FOR_REVISION = 'RETURNED_FOR_REVISION',
  CANCELLED = 'CANCELLED',
}

export enum ChangeRequestImpactType {
  SCOPE = 'SCOPE',
  COST = 'COST',
  SCHEDULE = 'SCHEDULE',
  QUALITY = 'QUALITY',
  SAFETY = 'SAFETY',
  DOCUMENTATION = 'DOCUMENTATION',
  OTHER = 'OTHER',
}

export enum ChangeRequestPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

@Entity('change_requests')
@Index('idx_change_requests_project_status', ['projectId', 'status'])
@Index('idx_change_requests_task_status', ['taskId', 'status'])
@Index('idx_change_requests_impact_type', ['impactType'])
@Index('idx_change_requests_priority', ['priority'])
@Index('idx_change_requests_created_by', ['createdByUserId'])
@Index('idx_change_requests_escalated_to', ['escalatedToUserId'])
@Index('idx_change_requests_resolved_by', ['resolvedByUserId'])
export class ChangeRequest extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => Task, (task) => task.changeRequests, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id', referencedColumnName: 'id' })
  createdByUser: User;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: false })
  createdByUserId: string;

  @Column({
    type: 'enum',
    enum: ChangeRequestStatus,
    enumName: 'change_requests_status_enum',
    nullable: false,
    default: ChangeRequestStatus.NEW,
  })
  status: ChangeRequestStatus;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'impact_type',
    type: 'enum',
    enum: ChangeRequestImpactType,
    enumName: 'change_requests_impact_type_enum',
    nullable: true,
  })
  impactType: ChangeRequestImpactType | null;

  @Column({
    type: 'enum',
    enum: ChangeRequestPriority,
    enumName: 'change_requests_priority_enum',
    nullable: true,
  })
  priority: ChangeRequestPriority | null;

  @Column({
    name: 'reason_category',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  reasonCategory: string | null;

  @Column({
    name: 'cost_impact_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  costImpactAmount: number | null;

  @Column({ name: 'schedule_impact_days', type: 'integer', nullable: true })
  scheduleImpactDays: number | null;

  @Column({ name: 'requested_due_date', type: 'date', nullable: true })
  requestedDueDate: string | null;

  @Column({ name: 'proposed_task_changes', type: 'jsonb', nullable: true })
  proposedTaskChanges: Record<string, unknown> | null;

  @ManyToMany(() => TaskDocument)
  @JoinTable({
    name: 'change_request_documents',
    joinColumn: {
      name: 'change_request_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'document_id',
      referencedColumnName: 'id',
    },
  })
  affectedDocuments: TaskDocument[];

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'escalated_to_user_id', referencedColumnName: 'id' })
  escalatedToUser: User | null;

  @Column({ name: 'escalated_to_user_id', type: 'uuid', nullable: true })
  escalatedToUserId: string | null;

  @Column({ name: 'escalated_at', type: 'timestamptz', nullable: true })
  escalatedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_user_id', referencedColumnName: 'id' })
  resolvedByUser: User | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @OneToMany(() => ChangeRequestReview, (review) => review.changeRequest)
  reviews: ChangeRequestReview[];

  @OneToMany(() => ChangeRequestAuditEntry, (entry) => entry.changeRequest)
  auditEntries: ChangeRequestAuditEntry[];

  @OneToOne(() => ChangeRequestThread, (thread) => thread.changeRequest)
  thread: ChangeRequestThread;
}
