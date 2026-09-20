import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';

export enum SubmissionOutcome {
  SUBMITTED = 'SUBMITTED',
  WITHDRAWN = 'WITHDRAWN',
  REJECTED = 'REJECTED',
  ACCEPTED = 'ACCEPTED',
}

@Entity('checklist_submissions')
@Index(
  'uq_checklist_submission_attempt',
  ['checklistItemId', 'attemptNumber'],
  { unique: true },
)
@Index('uq_checklist_active_submission', ['checklistItemId'], {
  unique: true,
  where: `outcome = 'SUBMITTED'`,
})
export class ChecklistSubmission extends AppBaseEntity {
  @Column('uuid') projectId: string;
  @Column('uuid') taskId: string;
  @Column('uuid') checklistItemId: string;
  @Column('int') attemptNumber: number;
  @Column('uuid') submittedByUserId: string;
  @Column('timestamptz') submittedAt: Date;
  @Column('varchar') source: 'drag' | 'submit';
  @Column({ type: 'varchar', default: SubmissionOutcome.SUBMITTED })
  outcome: SubmissionOutcome;
  @Column({ type: 'uuid', nullable: true }) outcomeByUserId: string | null;
  @Column({ type: 'timestamptz', nullable: true }) outcomeAt: Date | null;
  @Column({ type: 'text', nullable: true }) submissionNote: string | null;
}

@Entity('checklist_submission_evidence')
@Index('uq_submission_attachment', ['submissionId', 'attachmentId'], {
  unique: true,
})
export class ChecklistSubmissionEvidence extends AppBaseEntity {
  @Column('uuid') submissionId: string;
  @Column('uuid') documentId: string;
  @Column('uuid') attachmentId: string;
  @Column('jsonb') snapshot: Record<string, unknown>;
}

@Entity('checklist_review_notes')
@Index('uq_review_note_revision', ['noteId', 'revision'], { unique: true })
export class ChecklistReviewNote extends AppBaseEntity {
  @Column('uuid') submissionId: string;
  @Column('uuid') noteId: string;
  @Column('int') revision: number;
  @Column('uuid') authorUserId: string;
  @Column('text') text: string;
}

@Entity('checklist_workflow_receipts')
@Index(
  'uq_workflow_receipt',
  ['projectId', 'checklistItemId', 'actorUserId', 'idempotencyKey'],
  { unique: true },
)
export class ChecklistWorkflowReceipt extends AppBaseEntity {
  @Column('uuid') projectId: string;
  @Column('uuid') checklistItemId: string;
  @Column('uuid') actorUserId: string;
  @Column({ type: 'varchar', length: 128 }) idempotencyKey: string;
  @Column('varchar') commandHash: string;
  @Column('jsonb') response: Record<string, unknown>;
}

@Entity('task_document_revisions')
export class TaskDocumentRevision extends AppBaseEntity {
  @Column('uuid') documentId: string;
  @Column('uuid') actorUserId: string;
  @Column('jsonb') snapshot: Record<string, unknown>;
}

@Entity('task_workflow_receipts')
@Index(
  'uq_task_workflow_receipt',
  ['taskId', 'actorUserId', 'idempotencyKey'],
  { unique: true },
)
export class TaskWorkflowReceipt extends AppBaseEntity {
  @Column('uuid') taskId: string;
  @Column('uuid') actorUserId: string;
  @Column({ type: 'varchar', length: 128 }) idempotencyKey: string;
  @Column('varchar') commandHash: string;
  @Column('jsonb') response: Record<string, unknown>;
}

@Entity('task_workflow_activation')
export class TaskWorkflowActivation {
  @PrimaryColumn({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;
}
