import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Global permission catalogue — seeded once per deployment.
 * Permissions are resource-specific and workspace/user agnostic.
 * Workspace roles reference permission domains via a JSON matrix, not FK rows.
 * This table serves as a canonical source-of-truth for what domains + actions exist.
 */
@Entity('permissions')
@Unique(['domain', 'action'])
export class Permission {
  @PrimaryGeneratedColumn()
  pkid: number;

  @Column({ type: 'uuid', unique: true, default: () => 'uuid_generate_v4()' })
  id: string;

  /** Permission domain, e.g. 'userManagement', 'taskManagement'. */
  @Column({ type: 'varchar', length: 100, nullable: false })
  domain: string;

  /** Action within the domain: create | update | view | delete. */
  @Column({ type: 'varchar', length: 50, nullable: false })
  action: string;

  /** Human-readable explanation of what this permission controls. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
