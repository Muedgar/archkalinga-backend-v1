import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities/user.entity';
import { Workspace } from './workspace.entity';
import { WorkspaceRole } from 'src/roles/roles.entity';

export enum WorkspaceMemberStatus {
  ACTIVE  = 'ACTIVE',
  REMOVED = 'REMOVED',
}

@Entity('workspace_members')
@Unique(['workspaceId', 'userId'])
export class WorkspaceMember extends AppBaseEntity {
  // ── Workspace ─────────────────────────────────────────────────────────────
  @ManyToOne(() => Workspace, (ws) => ws.members, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'uuid', nullable: false })
  workspaceId: string;

  // ── User ──────────────────────────────────────────────────────────────────
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  // ── Role ──────────────────────────────────────────────────────────────────
  @ManyToOne(() => WorkspaceRole, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'workspace_role_id' })
  workspaceRole: WorkspaceRole;

  @Column({ type: 'uuid', nullable: false })
  workspaceRoleId: string;

  // ── Status ─────────────────────────────────────────────────────────────────
  @Column({
    type: 'enum',
    enum: WorkspaceMemberStatus,
    nullable: false,
    default: WorkspaceMemberStatus.ACTIVE,
  })
  status: WorkspaceMemberStatus;

  @Column({ type: 'timestamptz', nullable: true })
  joinedAt: Date | null;

  // ── Audit ─────────────────────────────────────────────────────────────────
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invited_by_user_id' })
  invitedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  invitedByUserId: string | null;
}
