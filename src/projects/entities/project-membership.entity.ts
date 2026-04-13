import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities/user.entity';
import { Project } from './project.entity';
import { ProjectInvite } from './project-invite.entity';
import { ProjectRole } from './project-role.entity';

export enum MembershipStatus {
  ACTIVE = 'ACTIVE',
  REMOVED = 'REMOVED',
}

@Entity('project_memberships')
export class ProjectMembership extends AppBaseEntity {
  @ManyToOne(() => Project, (p) => p.memberships, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ManyToOne(() => ProjectRole, (role) => role.memberships, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'project_role_id' })
  projectRole: ProjectRole;

  @Column({ type: 'uuid', nullable: false })
  projectRoleId: string;

  @Column({
    type: 'enum',
    enum: MembershipStatus,
    nullable: false,
    default: MembershipStatus.ACTIVE,
  })
  status: MembershipStatus;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invited_by_user_id' })
  invitedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  invitedByUserId: string | null;

  @ManyToOne(() => ProjectInvite, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invite_id' })
  invite: ProjectInvite | null;

  @Column({ type: 'uuid', nullable: true })
  inviteId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  joinedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;
}
