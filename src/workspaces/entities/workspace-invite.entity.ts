import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { WorkspaceRole } from 'src/roles/roles.entity';
import { User } from 'src/users/entities/user.entity';
import { Workspace } from './workspace.entity';

export enum WorkspaceInviteStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

@Entity('workspace_invites')
export class WorkspaceInvite extends AppBaseEntity {
  // ── Workspace ─────────────────────────────────────────────────────────────
  @ManyToOne(() => Workspace, (workspace) => workspace.invites, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'uuid', nullable: false })
  workspaceId: string;

  // ── Inviter ───────────────────────────────────────────────────────────────
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'inviter_user_id' })
  inviterUser: User;

  @Column({ type: 'uuid', nullable: false })
  inviterUserId: string;

  // ── Invitee ───────────────────────────────────────────────────────────────
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invitee_user_id' })
  inviteeUser: User;

  @Column({ type: 'uuid', nullable: false })
  inviteeUserId: string;

  // ── Workspace role assigned on acceptance ─────────────────────────────────
  @ManyToOne(() => WorkspaceRole, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'workspace_role_id' })
  workspaceRole: WorkspaceRole;

  @Column({ type: 'uuid', nullable: false })
  workspaceRoleId: string;

  // ── Token & lifecycle ─────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 128, nullable: false, unique: true })
  token: string;

  @Column({
    type: 'enum',
    enum: WorkspaceInviteStatus,
    nullable: false,
    default: WorkspaceInviteStatus.PENDING,
  })
  status: WorkspaceInviteStatus;

  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  // ── Optional message from inviter ─────────────────────────────────────────
  @Column({ type: 'text', nullable: true, default: null })
  message: string | null;
}
