import { AppBaseEntity } from 'src/common/entities';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Organization } from 'src/organizations/entities/organization.entity';
import { Role } from 'src/roles/roles.entity';

export enum UserType {
  INDIVIDUAL = 'INDIVIDUAL',
  ORGANIZATION = 'ORGANIZATION',
}

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

  @Column({
    type: 'enum',
    enum: UserType,
    nullable: false,
    default: UserType.INDIVIDUAL,
  })
  userType: UserType;

  @Column({ type: 'boolean', nullable: false, default: true })
  status: boolean;

  @Column({ type: 'boolean', nullable: false, default: true })
  isDefaultPassword: boolean;

  @Column({ type: 'boolean', nullable: false, default: false })
  twoFactorAuthentication: boolean;

  @Column({ type: 'boolean', nullable: false, default: false })
  emailVerified: boolean;

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

  // ── Tenant + workspace access ────────────────────────────────────────────
  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'uuid', nullable: false })
  organizationId: string;

  /** User-scoped workspace role. Project-scoped roles live on project memberships. */
  @ManyToOne(() => Role, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'role_id' })
  role: Role | null;

  /** UUID of the user's workspace role. */
  @Column({ type: 'uuid', nullable: true })
  roleId: string | null;

  // ── Audit ─────────────────────────────────────────────────────────────────
  /** The admin user who created this account (null for self-signup). */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;
}
