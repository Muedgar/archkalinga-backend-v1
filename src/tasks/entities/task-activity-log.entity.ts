import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';

export enum TaskActionType {
  TASK_CREATED = 'TASK_CREATED',
  TASK_UPDATED = 'TASK_UPDATED',
  TASK_MOVED = 'TASK_MOVED',
  TASK_DELETED = 'TASK_DELETED',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_UNASSIGNED = 'TASK_UNASSIGNED',
  COMMENT_ADDED = 'COMMENT_ADDED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  CHECKLIST_UPDATED = 'CHECKLIST_UPDATED',
  DEPENDENCY_ADDED = 'DEPENDENCY_ADDED',
  DEPENDENCY_REMOVED = 'DEPENDENCY_REMOVED',
}

@Entity('task_activity_logs')
export class TaskActivityLog extends AppBaseEntity {
  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: User;

  @Column({ type: 'uuid', nullable: false })
  actorUserId: string;

  @Column({ type: 'enum', enum: TaskActionType, nullable: false })
  actionType: TaskActionType;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  actionMeta: Record<string, unknown> | null;
}
