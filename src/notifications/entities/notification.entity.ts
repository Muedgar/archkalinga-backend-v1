import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities/user.entity';

export enum NotificationType {
  INVITE_RECEIVED = 'INVITE_RECEIVED',
  INVITE_ACCEPTED = 'INVITE_ACCEPTED',
  INVITE_DECLINED = 'INVITE_DECLINED',
  INVITE_REVOKED  = 'INVITE_REVOKED',
  PROJECT_UPDATE  = 'PROJECT_UPDATE',
  GENERAL         = 'GENERAL',
}

@Entity('notifications')
export class Notification extends AppBaseEntity {
  // ── Recipient ──────────────────────────────────────────────────────────────
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid', nullable: false })
  userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  declare createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  declare updatedAt: Date;

  // ── Content ────────────────────────────────────────────────────────────────
  @Column({
    type: 'enum',
    enum: NotificationType,
    nullable: false,
    default: NotificationType.GENERAL,
  })
  type: NotificationType;

  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false })
  body: string;

  // ── State ──────────────────────────────────────────────────────────────────
  @Column({ name: 'is_read', type: 'boolean', nullable: false, default: false })
  isRead: boolean;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true, default: null })
  readAt: Date | null;

  // ── Optional metadata ──────────────────────────────────────────────────────
  /** Arbitrary context — e.g. { projectId, inviteId } for invite notifications. */
  @Column({ type: 'jsonb', nullable: true, default: null })
  meta: Record<string, unknown> | null;
}
