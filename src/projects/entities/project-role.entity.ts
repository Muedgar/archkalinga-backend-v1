import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from './project.entity';
import { ProjectMembership } from './project-membership.entity';
import { ProjectInvite } from './project-invite.entity';
import type { ProjectPermissionMatrix } from '../types/project-permission-matrix.type';

@Entity('project_roles')
@Unique(['projectId', 'slug'])
export class ProjectRole extends AppBaseEntity {
  @ManyToOne(() => Project, (project) => project.projectRoles, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  slug: string;

  @Column({ type: 'boolean', nullable: false, default: true })
  status: boolean;

  @Column({ type: 'boolean', nullable: false, default: false })
  isSystem: boolean;

  @Column({ type: 'boolean', nullable: false, default: false })
  isProtected: boolean;

  @Column({ type: 'jsonb', nullable: false })
  permissions: ProjectPermissionMatrix;

  @OneToMany(() => ProjectMembership, (membership) => membership.projectRole)
  memberships: ProjectMembership[];

  @OneToMany(() => ProjectInvite, (invite) => invite.projectRole)
  invites: ProjectInvite[];
}
