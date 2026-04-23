import { Column, Entity, OneToMany } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { WorkspaceMember } from './workspace-member.entity';

@Entity('workspaces')
export class Workspace extends AppBaseEntity {
  @Column({ type: 'varchar', length: 200, nullable: false })
  name: string;

  /** URL-safe unique identifier derived from the workspace name. */
  @Column({ type: 'varchar', length: 220, nullable: false, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * When true, all active members of this workspace are discoverable in user
   * search by other authenticated users — regardless of their individual
   * isPublicProfile setting. Workspace admins control this setting.
   */
  @Column({
    name: 'allow_public_profiles',
    type: 'boolean',
    nullable: false,
    default: false,
  })
  allowPublicProfiles: boolean;

  @OneToMany(() => WorkspaceMember, (m) => m.workspace)
  members: WorkspaceMember[];
}
