import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';

/**
 * project_task_types — project-scoped task type definitions.
 * e.g. Task, Bug, Feature, Story, Subtask.
 * isSubtaskType flags types that are only valid as child tasks.
 */
@Entity('project_task_types')
@Unique(['projectId', 'key'])
export class ProjectTaskType extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  /** Display name, e.g. "Bug" */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Machine-readable slug unique per project, e.g. "bug" */
  @Column({ type: 'varchar', length: 50 })
  key: string;

  /** Optional icon identifier (e.g. heroicon name or emoji) */
  @Column({ type: 'varchar', length: 50, nullable: true })
  icon: string | null;

  @Column({ type: 'varchar', length: 20, default: '#6B7280' })
  color: string;

  /** Assigned on task create when no type is given */
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  /** Types that may only be used for child (subtask) tasks */
  @Column({ type: 'boolean', default: false })
  isSubtaskType: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
