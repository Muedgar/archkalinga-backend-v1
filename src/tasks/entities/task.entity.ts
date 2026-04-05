import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { User } from 'src/users/entities';
import { WorkflowColumn } from '../workflow/workflow-column.entity';
import { TaskAssignee } from './task-assignee.entity';
import { TaskChecklistItem } from './task-checklist-item.entity';
import { TaskComment } from './task-comment.entity';
import { TaskDependency } from './task-dependency.entity';
import { TaskViewMetadata } from './task-view-metadata.entity';

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
  BLOCKED = 'BLOCKED',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

@Entity('tasks')
export class Task extends AppBaseEntity {
  @Column({ type: 'varchar', length: 500, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.TODO })
  status: TaskStatus;

  @Column({ type: 'enum', enum: TaskPriority, nullable: true })
  priority: TaskPriority | null;

  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  @Column({ type: 'smallint', nullable: true })
  progress: number | null;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @ManyToOne(() => WorkflowColumn, (column) => column.tasks, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'workflow_column_id' })
  workflowColumn: WorkflowColumn | null;

  @Column({ type: 'uuid', nullable: true })
  workflowColumnId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  rank: string | null;

  @ManyToOne(() => Task, (task) => task.children, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_task_id' })
  parent: Task | null;

  @Column({ type: 'uuid', nullable: true })
  parentTaskId: string | null;

  @OneToMany(() => Task, (task) => task.parent)
  children: Task[];

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User;

  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reportee_user_id' })
  reporteeUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  reporteeUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => TaskAssignee, (assignee) => assignee.task)
  assignees: TaskAssignee[];

  @OneToMany(() => TaskChecklistItem, (item) => item.task)
  checklistItems: TaskChecklistItem[];

  @OneToMany(() => TaskComment, (comment) => comment.task)
  comments: TaskComment[];

  @OneToMany(() => TaskDependency, (dependency) => dependency.task)
  dependencyEdges: TaskDependency[];

  @OneToMany(() => TaskViewMetadata, (metadata) => metadata.task)
  viewMetadataEntries: TaskViewMetadata[];
}
