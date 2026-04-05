import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities/user.entity';
import { Project } from './project.entity';
import { ProjectRole } from './project-role.entity';

export enum InviteStatus {
  PENDING  = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED  = 'EXPIRED',
  REVOKED  = 'REVOKED',
}

/** Describes what context the invite was sent from. */
export enum InviteTargetType {
  PROJECT  = 'project',
  TASK     = 'task',
  SUBTASK  = 'subtask',
}

@Entity('project_invites')
export class ProjectInvite extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'inviter_user_id' })
  inviterUser: User;

  @Column({ type: 'uuid', nullable: false })
  inviterUserId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invitee_user_id' })
  inviteeUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  inviteeUserId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: false })
  inviteeEmail: string;

  @ManyToOne(() => ProjectRole, (role) => role.invites, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'project_role_id' })
  projectRole: ProjectRole;

  @Column({ type: 'uuid', nullable: false })
  projectRoleId: string;

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

  // ── Task-context fields (all nullable — project-only invites omit these) ─────

  /**
   * UUID of the task this invite was sent from.
   * Null for plain project invites.
   */
  @Column({ type: 'uuid', nullable: true, default: null })
  taskId: string | null;

  /**
   * UUID of the subtask this invite was sent from.
   * Requires taskId to be set. Null for task-level invites.
   */
  @Column({ type: 'uuid', nullable: true, default: null })
  subtaskId: string | null;

  /**
   * Describes where the invite originated.
   * Defaults to 'project' to preserve backward-compat with existing records.
   */
  @Column({
    type: 'enum',
    enum: InviteTargetType,
    nullable: false,
    default: InviteTargetType.PROJECT,
  })
  targetType: InviteTargetType;

  /** Denormalized task/subtask title for display without a DB join. */
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  targetName: string | null;

  /** Denormalized project title for display in invite emails / UI. */
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  projectName: string | null;

  /** Optional personalised message from the inviter. */
  @Column({ type: 'text', nullable: true, default: null })
  message: string | null;

  /**
   * When true, the invitee is automatically added as a task/subtask assignee
   * (CONTRIBUTOR role) immediately after accepting the invite.
   */
  @Column({ type: 'boolean', nullable: false, default: false })
  autoAssignOnAccept: boolean;
}
