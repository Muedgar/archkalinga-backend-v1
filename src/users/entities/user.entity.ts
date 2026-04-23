import { AppBaseEntity } from 'src/common/entities';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

@Entity('users')
export class User extends AppBaseEntity {
  @Column({ type: 'varchar', length: 200, nullable: true })
  userName: string;

  @Column({ type: 'varchar', length: 200, nullable: false })
  firstName: string;

  @Column({ type: 'varchar', length: 200, nullable: false })
  lastName: string;

  @Column({ type: 'varchar', length: 100, nullable: false, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 250, nullable: false })
  password: string;

  /** Professional title / designation (e.g. "Senior Architect"). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  @Column({ type: 'boolean', nullable: false, default: true })
  status: boolean;

  @Column({ type: 'boolean', nullable: false, default: true })
  isDefaultPassword: boolean;

  @Column({ type: 'boolean', nullable: false, default: false })
  twoFactorAuthentication: boolean;

  @Column({ type: 'boolean', nullable: false, default: false })
  emailVerified: boolean;

  /**
   * When true this user's profile (name, title, workspace) is discoverable
   * by other authenticated users searching for people to invite to a project.
   * Defaults to false — users or workspace admins opt in explicitly.
   */
  @Column({
    name: 'is_public_profile',
    type: 'boolean',
    nullable: false,
    default: false,
  })
  isPublicProfile: boolean;

  @Column({ type: 'varchar', length: 250, nullable: true })
  emailVerificationKey: string;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerificationExpiry: Date;

  /**
   * Incremented on password change, logout-all, or account lock.
   * Embedded in every access-token payload; a mismatch means the token
   * was issued before the revocation event and must be rejected.
   */
  @Column({ type: 'integer', nullable: false, default: 0 })
  tokenVersion: number;

  /** Consecutive failed login attempts — reset to 0 on success. */
  @Column({ type: 'integer', nullable: false, default: 0 })
  failedLoginAttempts: number;

  /** Non-null while the account is temporarily locked after too many failures. */
  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  // ── Password reset (one-time nonce) ──────────────────────────────────────
  @Column({ type: 'varchar', length: 64, nullable: true })
  passwordResetTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  passwordResetTokenExpiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  passwordResetTokenUsedAt: Date | null;

  // ── Audit ─────────────────────────────────────────────────────────────────
  /** The admin user who created this account (null for self-signup). */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;
}
