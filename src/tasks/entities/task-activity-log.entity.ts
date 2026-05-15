import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';

export enum TaskActionType {
  TASK_CREATED = 'task:created',
  TASK_UPDATED = 'task:updated',
  TASK_MOVED = 'task:moved',
  TASK_DELETED = 'task:deleted',
  TASK_ASSIGNED = 'task:assigned',
  TASK_UNASSIGNED = 'task:unassigned',
  COMMENT_ADDED = 'comment:added',
  STATUS_CHANGED = 'task:status_changed',
  CHECKLIST_UPDATED = 'checklist:toggled',
  DEPENDENCY_ADDED = 'task:updated',
  DEPENDENCY_REMOVED = 'task:updated',
}

@Entity('task_activity_logs')
export class TaskActivityLog extends AppBaseEntity {
  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: User | null;

  @Column({ name: 'actorUserId', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'actorName', type: 'varchar', length: 200, nullable: true })
  actorName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: false })
  actionType: TaskActionType;

  @Column({ name: 'actionMeta', type: 'jsonb', nullable: true, default: {} })
  actionMeta: Record<string, unknown> | null;
}
