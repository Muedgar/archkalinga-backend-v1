import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';
import { ChangeRequestThread } from './change-request-thread.entity';

export enum ChangeRequestStatus {
  NEW = 'NEW',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
}

@Entity('change_requests')
@Index('idx_change_requests_project_status', ['projectId', 'status'])
@Index('idx_change_requests_task_status', ['taskId', 'status'])
@Index('idx_change_requests_created_by', ['createdByUserId'])
@Index('idx_change_requests_escalated_to', ['escalatedToUserId'])
@Index('idx_change_requests_resolved_by', ['resolvedByUserId'])
export class ChangeRequest extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => Task, (task) => task.changeRequests, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id', referencedColumnName: 'id' })
  createdByUser: User;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: false })
  createdByUserId: string;

  @Column({
    type: 'enum',
    enum: ChangeRequestStatus,
    enumName: 'change_requests_status_enum',
    nullable: false,
    default: ChangeRequestStatus.NEW,
  })
  status: ChangeRequestStatus;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'escalated_to_user_id', referencedColumnName: 'id' })
  escalatedToUser: User | null;

  @Column({ name: 'escalated_to_user_id', type: 'uuid', nullable: true })
  escalatedToUserId: string | null;

  @Column({ name: 'escalated_at', type: 'timestamptz', nullable: true })
  escalatedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_user_id', referencedColumnName: 'id' })
  resolvedByUser: User | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @OneToOne(() => ChangeRequestThread, (thread) => thread.changeRequest)
  thread: ChangeRequestThread;
}
