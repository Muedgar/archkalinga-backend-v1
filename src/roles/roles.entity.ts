import { AppBaseEntity } from 'src/common/entities';
import { Column, Entity, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from 'src/organizations/entities/organization.entity';
import type { PermissionMatrix } from './types/permission-matrix.type';

/** Workspace role assigned directly to a user within an organization. */
@Entity('roles')
export class Role extends AppBaseEntity {
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

  // ── Organization scope ────────────────────────────────────────────────────
  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'uuid', nullable: false })
  organizationId: string;
}
