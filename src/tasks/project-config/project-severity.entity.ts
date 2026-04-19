import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';

/**
 * project_severities — project-scoped severity/impact level definitions.
 * Severity indicates the impact of a bug or issue (separate from priority).
 */
@Entity('project_severities')
@Unique(['projectId', 'key'])
export class ProjectSeverity extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  /** Display name, e.g. "Critical" */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Machine-readable slug unique per project, e.g. "critical" */
  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 20, default: '#6B7280' })
  color: string;

  /** Numeric weight for sorting; higher = more severe */
  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  /** Assigned on task create when no severity is given */
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
