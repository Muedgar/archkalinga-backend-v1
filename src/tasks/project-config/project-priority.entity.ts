import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';

/**
 * project_priorities — project-scoped priority definitions.
 * orderIndex drives sort order; isDefault marks the priority assigned when none given.
 */
@Entity('project_priorities')
@Unique(['projectId', 'key'])
export class ProjectPriority extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  /** Display name, e.g. "High" */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Machine-readable slug unique per project, e.g. "high" */
  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 20, default: '#6B7280' })
  color: string;

  /** Numeric weight for sorting; higher = more urgent */
  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  /** Assigned on task create when no priority is given */
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
