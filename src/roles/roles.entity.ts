import { AppBaseEntity } from 'src/common/entities';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import type { PermissionMatrix } from './types/permission-matrix.type';

/** Workspace role scoped to a single workspace and assigned via WorkspaceMember. */
@Entity('workspace_roles')
export class WorkspaceRole extends AppBaseEntity {
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  slug: string;

  @Column({ type: 'boolean', nullable: false, default: true })
  status: boolean;

  /**
   * Workspace permission matrix stored as JSONB.
   * Shape: { [domain]: { create, update, view, delete } }
   */
  @Column({ type: 'jsonb', nullable: false })
  permissions: PermissionMatrix;

  /**
   * System roles (e.g. the seeded Admin role) cannot be deleted.
   * They can still be updated by workspace admins.
   */
  @Column({ type: 'boolean', nullable: false, default: false })
  isSystem: boolean;

  // ── Workspace scope ────────────────────────────────────────────────────────
  @ManyToOne(() => Workspace, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'uuid', nullable: false })
  workspaceId: string;
}

/** Backward-compat alias so existing imports of `Role` keep working during migration. */
export { WorkspaceRole as Role };
