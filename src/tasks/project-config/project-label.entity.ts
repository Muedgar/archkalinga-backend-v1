import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';

/**
 * project_labels — project-scoped label/tag definitions.
 * Labels are many-to-many with tasks via task_labels join table.
 * No default labels seeded; teams create their own taxonomy.
 */
@Entity('project_labels')
@Unique(['projectId', 'key'])
export class ProjectLabel extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  /** Display name, e.g. "Frontend" */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Machine-readable slug unique per project, e.g. "frontend" */
  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 20, default: '#6B7280' })
  color: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
