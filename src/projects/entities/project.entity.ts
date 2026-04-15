import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { Template } from 'src/templates/entities/template.entity';
import { User } from 'src/users/entities/user.entity';
import { ProjectMembership } from './project-membership.entity';
import { ProjectActivityLog } from './project-activity-log.entity';
import { ProjectInvite } from './project-invite.entity';
import { ProjectRole } from './project-role.entity';

export enum ProjectType {
  ARCHITECTURE = 'ARCHITECTURE',
  STRUCTURE = 'STRUCTURE',
  MEP = 'MEP',
  INTERIOR = 'INTERIOR',
}

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

@Entity('projects')
export class Project extends AppBaseEntity {
  @Column({ type: 'varchar', length: 200, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  @Column({ type: 'enum', enum: ProjectType, nullable: false })
  type: ProjectType;

  @Column({
    type: 'enum',
    enum: ProjectStatus,
    nullable: false,
    default: ProjectStatus.ACTIVE,
  })
  status: ProjectStatus;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  // ── Tenant ────────────────────────────────────────────────────────────────
  @ManyToOne(() => Workspace, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'uuid', nullable: false })
  workspaceId: string;

  // ── Template ──────────────────────────────────────────────────────────────
  @ManyToOne(() => Template, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'template_id' })
  template: Template;

  @Column({ type: 'uuid', nullable: false })
  templateId: string;

  // ── Creator ───────────────────────────────────────────────────────────────
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdByUser: User;

  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  // ── Relations ─────────────────────────────────────────────────────────────
  @OneToMany(() => ProjectMembership, (m) => m.project)
  memberships: ProjectMembership[];

  @OneToMany(() => ProjectInvite, (invite) => invite.project)
  invites: ProjectInvite[];

  @OneToMany(() => ProjectRole, (role) => role.project)
  projectRoles: ProjectRole[];

  @OneToMany(() => ProjectActivityLog, (a) => a.project)
  activityLogs: ProjectActivityLog[];
}
