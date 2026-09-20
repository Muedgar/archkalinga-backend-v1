import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';

export enum CanonicalStage {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
}

export enum StatusCategory {
  NOT_STARTED = 'not_started',
  ACTIVE = 'active',
  DONE = 'done',
  CANCELLED = 'cancelled',
  BLOCKED = 'blocked',
}

export enum CompletionPolicy {
  NONE = 'none',
  COMPLETE_TASK_ONLY = 'complete_task_only',
  COMPLETE_OPEN_WORK_ITEMS = 'complete_open_work_items',
  REQUIRE_ALL_WORK_ITEMS_DONE = 'require_all_work_items_done',
}

/**
 * project_statuses — replaces the old workflow_columns table.
 * Each row IS a Kanban column; orderIndex drives column order.
 */
@Entity('project_statuses')
@Unique(['projectId', 'key'])
export class ProjectStatus extends AppBaseEntity {
  @Column({
    name: 'canonical_stage',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  canonicalStage: CanonicalStage | null;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  /** Display name, e.g. "In Progress" */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Machine-readable slug unique per project, e.g. "in_progress" */
  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 20, default: '#6B7280' })
  color: string;

  /** Position of this column in the Kanban board */
  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  /** Max tasks allowed; NULL = unlimited */
  @Column({ type: 'int', nullable: true })
  wipLimit: number | null;

  /** Semantic bucket used by workflow, analytics, and completion rules. */
  @Column({ type: 'varchar', length: 20, default: StatusCategory.ACTIVE })
  category: StatusCategory;

  /** Assigned on task create when no status is given */
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  /** Tasks in a terminal status cannot be edited */
  @Column({ type: 'boolean', default: false })
  isTerminal: boolean;

  /** True only for statuses that mean work completed successfully. */
  @Column({ type: 'boolean', default: false })
  isDone: boolean;

  /** Policy applied when a task transitions into this status. */
  @Column({
    type: 'varchar',
    length: 40,
    default: CompletionPolicy.NONE,
  })
  completionPolicy: CompletionPolicy;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
