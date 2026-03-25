import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities/user.entity';
import { Project } from './project.entity';

export enum ProjectActionType {
  PROJECT_CREATED = 'PROJECT_CREATED',
  PROJECT_UPDATED = 'PROJECT_UPDATED',
  MEMBER_ADDED    = 'MEMBER_ADDED',
  MEMBER_REMOVED  = 'MEMBER_REMOVED',
  INVITE_SENT     = 'INVITE_SENT',
  INVITE_ACCEPTED = 'INVITE_ACCEPTED',
  STATUS_CHANGED  = 'STATUS_CHANGED',
}

@Entity('project_activity_logs')
export class ProjectActivityLog extends AppBaseEntity {
  @ManyToOne(() => Project, (p) => p.activityLogs, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  /** Nullable — future task-level activities will set this. */
  @Column({ type: 'uuid', nullable: true })
  taskId: string | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  actionType: string;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  actionMeta: Record<string, unknown> | null;
}
