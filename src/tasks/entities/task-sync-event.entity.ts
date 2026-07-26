import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';

export enum TaskSyncEventType {
  CHECKLIST_ITEM_TOGGLED = 'checklist_item_toggled',
  TASK_PROGRESS_UPDATED = 'task_progress_updated',
  SITE_NOTE_ADDED = 'site_note_added',
  LOCATION_PROGRESS_UPDATED = 'location_progress_updated',
}

export enum TaskSyncEventStatus {
  APPLIED = 'applied',
  FAILED = 'failed',
}

@Entity('task_sync_events')
@Index(
  'idx_task_sync_events_project_client_unique',
  ['projectId', 'clientEventId'],
  {
    unique: true,
  },
)
@Index('idx_task_sync_events_task_created', ['taskId', 'createdAt'])
export class TaskSyncEvent extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({
    name: 'client_event_id',
    type: 'varchar',
    length: 120,
    nullable: false,
  })
  clientEventId: string;

  @Column({ type: 'varchar', length: 80, nullable: false })
  type: TaskSyncEventType;

  @Column({ type: 'varchar', length: 30, nullable: false })
  status: TaskSyncEventStatus;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id', referencedColumnName: 'id' })
  actorUser: User | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: false })
  occurredAt: Date;

  @Column({ type: 'jsonb', nullable: false, default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
}
