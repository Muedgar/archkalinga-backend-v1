import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities/user.entity';
import { Project } from './project.entity';

export enum InviteRole {
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

export enum InviteStatus {
  PENDING  = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED  = 'EXPIRED',
  REVOKED  = 'REVOKED',
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

  @Column({
    type: 'enum',
    enum: InviteRole,
    nullable: false,
    default: InviteRole.MEMBER,
  })
  role: InviteRole;

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
}
