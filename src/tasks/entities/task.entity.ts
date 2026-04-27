import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { User } from 'src/users/entities';
import {
  ProjectPriority,
  ProjectSeverity,
  ProjectStatus,
  ProjectTaskType,
} from '../project-config';
import { TaskAssignee } from './task-assignee.entity';
import { TaskChecklist } from './task-checklist.entity';
import { TaskChecklistItem } from './task-checklist-item.entity';
import { TaskComment } from './task-comment.entity';
import { TaskDependency } from './task-dependency.entity';
import { TaskLabel } from './task-label.entity';
import { TaskRelation } from './task-relation.entity';
import { TaskViewMetadata } from './task-view-metadata.entity';
import { TaskWatcher } from './task-watcher.entity';

@Entity('tasks')
export class Task extends AppBaseEntity {
  @Column({ type: 'varchar', length: 500, nullable: false })
  title: string;

  /** Rich-text content stored as a ProseMirror/TipTap JSON document. */
  @Column({ type: 'jsonb', nullable: true })
  description: Record<string, unknown> | null;

  // ── Status FK ──────────────────────────────────────────────────────────────
  // referencedColumnName: 'id' ensures TypeORM treats status_id as UUID (→ project_statuses.id),
  // not integer (→ project_statuses.pkid). Without it, synchronize rewrites the column to
  // integer and the UUID insert fails with "invalid input syntax for type integer".
  @ManyToOne(() => ProjectStatus, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'status_id', referencedColumnName: 'id' })
  status: ProjectStatus;

  @Column({ type: 'uuid', nullable: false, name: 'status_id' })
  statusId: string;

  // ── Priority FK ───────────────────────────────────────────────────────────
  @ManyToOne(() => ProjectPriority, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'priority_id', referencedColumnName: 'id' })
  priority: ProjectPriority | null;

  @Column({ type: 'uuid', nullable: true, name: 'priority_id' })
  priorityId: string | null;

  // ── Task Type FK ──────────────────────────────────────────────────────────
  @ManyToOne(() => ProjectTaskType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'task_type_id', referencedColumnName: 'id' })
  taskType: ProjectTaskType;

  @Column({ type: 'uuid', nullable: false, name: 'task_type_id' })
  taskTypeId: string;

  // ── Severity FK ───────────────────────────────────────────────────────────
  @ManyToOne(() => ProjectSeverity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'severity_id', referencedColumnName: 'id' })
  severity: ProjectSeverity | null;

  @Column({ type: 'uuid', nullable: true, name: 'severity_id' })
  severityId: string | null;

  // ── Dates & progress ──────────────────────────────────────────────────────
  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  @Column({ type: 'smallint', nullable: true })
  progress: number | null; // Self reported: is a gradual estimate — useful for long-running tasks where you want to communicate partial progress before it's fully done

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  rank: string | null; // fractional indexing for reordering tasks in columns.

  // ── Hierarchy ─────────────────────────────────────────────────────────────
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

  // ── Project & ownership ───────────────────────────────────────────────────
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

  // ── Relations ─────────────────────────────────────────────────────────────
  @OneToMany(() => TaskAssignee, (assignee) => assignee.task)
  assignees: TaskAssignee[];

  @OneToMany(() => TaskChecklist, (group) => group.task)
  checklistGroups: TaskChecklist[];

  @OneToMany(() => TaskChecklistItem, (item) => item.task)
  checklistItems: TaskChecklistItem[];

  @OneToMany(() => TaskComment, (comment) => comment.task)
  comments: TaskComment[];

  @OneToMany(() => TaskDependency, (dependency) => dependency.task)
  dependencyEdges: TaskDependency[];

  @OneToMany(() => TaskLabel, (label) => label.task)
  labels: TaskLabel[];

  @OneToMany(() => TaskWatcher, (watcher) => watcher.task)
  watchers: TaskWatcher[];

  @OneToMany(() => TaskRelation, (relation) => relation.task)
  outgoingRelations: TaskRelation[];

  @OneToMany(() => TaskRelation, (relation) => relation.relatedTask)
  incomingRelations: TaskRelation[];

  @OneToMany(() => TaskViewMetadata, (metadata) => metadata.task)
  viewMetadataEntries: TaskViewMetadata[];
}
