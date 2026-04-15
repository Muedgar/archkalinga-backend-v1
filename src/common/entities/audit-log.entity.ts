import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from 'src/users/entities';
import { Workspace } from 'src/workspaces/entities/workspace.entity';

/**
 * AuditLog — immutable event record.
 *
 * Captures who did what, in which workspace, and what the outcome was.
 * Intentionally does NOT extend AppBaseEntity — audit logs are
 * append-only and never updated, so updatedAt and version are irrelevant.
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  pkid: number;

  @Column({ type: 'uuid', unique: true, default: () => 'uuid_generate_v4()' })
  id: string;

  /** The user who triggered the action. NULL if the actor was deleted. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  /** The workspace the action was performed in. NULL for cross-workspace actions. */
  @ManyToOne(() => Workspace, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace | null;

  /** Action label, e.g. "create:user", "delete:project" */
  @Column({ type: 'varchar', length: 100, nullable: false })
  action: string;

  /** Resource type, e.g. "user", "project", "template" */
  @Column({ type: 'varchar', length: 100, nullable: false })
  resource: string;

  /** UUID of the affected record. NULL for list/create operations. */
  @Column({ type: 'varchar', nullable: true })
  resourceId: string | null;

  /** Sanitised request payload (passwords and tokens redacted). */
  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  /** Serialised response data (first 4 KB). */
  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  /** IPv4 / IPv6 address of the caller. */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
