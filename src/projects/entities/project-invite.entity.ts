import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities/user.entity';
import { Project } from './project.entity';
import { ProjectRole } from './project-role.entity';

export enum InviteStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

@Entity('project_invites')
export class ProjectInvite extends AppBaseEntity {
  // ── Project ────────────────────────────────────────────────────────────────
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  // ── Inviter ────────────────────────────────────────────────────────────────
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'inviter_user_id' })
  inviterUser: User;

  @Column({ type: 'uuid', nullable: false })
  inviterUserId: string;

  // ── Invitee ────────────────────────────────────────────────────────────────
  /**
   * The user being invited. Must already have an account — discovered via
   * GET /users/search before the invite is created.
   *
   * A partial unique index in the DB enforces one PENDING invite per
   * (project_id, invitee_user_id) pair — see migration.
   */
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invitee_user_id' })
  inviteeUser: User;

  @Column({ type: 'uuid', nullable: false })
  inviteeUserId: string;

  // ── Project role assigned on acceptance ────────────────────────────────────
  @ManyToOne(() => ProjectRole, (role) => role.invites, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'project_role_id' })
  projectRole: ProjectRole;

  @Column({ type: 'uuid', nullable: false })
  projectRoleId: string;

  // ── Token & lifecycle ──────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 128, nullable: false, unique: true })
  token: string;

  @Column({
    type: 'enum',
    enum: InviteStatus,
    nullable: false,
    default: InviteStatus.PENDING,
  })
  status: InviteStatus;

  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  // ── Optional message from inviter ──────────────────────────────────────────
  @Column({ type: 'text', nullable: true, default: null })
  message: string | null;
}
