import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';

export enum StatusCategory {
  TODO        = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE        = 'done',
}

/**
 * project_statuses — replaces the old workflow_columns table.
 * Each row IS a Kanban column; orderIndex drives column order.
 */
@Entity('project_statuses')
@Unique(['projectId', 'key'])
export class ProjectStatus extends AppBaseEntity {
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

  /**
   * Semantic bucket: 'todo' | 'in_progress' | 'done'.
   * Used for Gantt colouring and analytics; 'done' auto-sets tasks.completed.
   */
  @Column({ type: 'varchar', length: 20, default: StatusCategory.IN_PROGRESS })
  category: StatusCategory;

  /** Assigned on task create when no status is given */
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  /** Tasks in a terminal status cannot be edited */
  @Column({ type: 'boolean', default: false })
  isTerminal: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
