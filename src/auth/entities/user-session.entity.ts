import { AppBaseEntity } from 'src/common/entities';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { User } from 'src/users/entities';

/**
 * UserSession — Phase 10 refresh-token store.
 *
 * One row per active device/session. The raw refresh token is NEVER stored;
 * only its SHA-256 hash is persisted. This limits damage if the sessions
 * table is compromised (hashes cannot be reversed to usable tokens).
 *
 * Revocation: set `revokedAt` to the current timestamp.
 * Rotation:   on every POST /auth/refresh the old row is revoked and a new
 *             row is inserted, making stolen token re-use detectable.
 */
@Entity('user_sessions')
export class UserSession extends AppBaseEntity {
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** SHA-256 hex-digest of the raw refresh token sent to the client. */
  @Column({ type: 'varchar', length: 64, nullable: false, unique: true })
  refreshTokenHash: string;

  /** IPv4 / IPv6 address at session creation. */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  /** Parsed from User-Agent (e.g. "Chrome on macOS"). */
  @Column({ type: 'varchar', length: 250, nullable: true })
  deviceLabel: string | null;

  /** Absolute expiry — the token cannot be used after this point. */
  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  /** Updated on every successful token refresh (sliding inactivity window). */
  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  /** Set when the session is explicitly logged out or rotated. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
