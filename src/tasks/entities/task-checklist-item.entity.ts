import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { ProjectStatus } from '../project-config';
import { Task } from './task.entity';
import { TaskChecklist } from './task-checklist.entity';

export enum TaskChecklistBranchStatus {
  FLAT = 'flat',
  BRANCHED = 'branched',
}

@Entity('task_checklist_items')
@Index('idx_task_checklist_items_branched_task_unique', ['branchedTaskId'], {
  unique: true,
  where: '"branched_task_id" IS NOT NULL',
})
export class TaskChecklistItem extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.checklistItems, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  /** Optional checklist group this item belongs to. */
  @ManyToOne(() => TaskChecklist, (group) => group.items, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'checklist_group_id' })
  checklistGroup: TaskChecklist | null;

  @Column({ type: 'uuid', nullable: true, name: 'checklist_group_id' })
  checklistGroupId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: false })
  text: string;

  @Column({ type: 'jsonb', nullable: true })
  description: Record<string, unknown> | null;

  @Column({ name: 'package_managed', type: 'boolean', default: false })
  packageManaged: boolean;

  @Column({ name: 'legacy_branch', type: 'boolean', default: false })
  legacyBranch: boolean;

  @Column({ name: 'assigned_members', type: 'jsonb', default: [] })
  assignedMembers: { userId: string; projectRoleId?: string }[];

  @Column({ name: 'reportee_user_id', type: 'uuid', nullable: true })
  reporteeUserId: string | null;

  @Column({
    name: 'duration_days',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 1,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  durationDays: number;

  @Column({ name: 'earliest_start_date', type: 'date', nullable: true })
  earliestStartDate: string | null;

  @Column({ name: 'planned_start_date', type: 'date', nullable: true })
  plannedStartDate: string | null;

  @Column({ name: 'planned_end_date', type: 'date', nullable: true })
  plannedEndDate: string | null;

  // Request-specific permission; never persisted.
  canBranch?: boolean;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @ManyToOne(() => ProjectStatus, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'status_id', referencedColumnName: 'id' })
  status: ProjectStatus;

  @Column({ type: 'uuid', nullable: false, name: 'status_id' })
  statusId: string;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  rank: string | null;

  @Column({ name: 'item_code', type: 'varchar', length: 100, nullable: true })
  itemCode: string | null;

  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branched_task_id', referencedColumnName: 'id' })
  branchedTask: Task | null;

  @Column({ name: 'branched_task_id', type: 'uuid', nullable: true })
  branchedTaskId: string | null;

  @Column({
    name: 'branch_status',
    type: 'varchar',
    length: 30,
    default: TaskChecklistBranchStatus.FLAT,
  })
  branchStatus: TaskChecklistBranchStatus;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branched_by_user_id', referencedColumnName: 'id' })
  branchedByUser: User | null;

  @Column({ name: 'branched_by_user_id', type: 'uuid', nullable: true })
  branchedByUserId: string | null;

  @Column({ name: 'branched_at', type: 'timestamptz', nullable: true })
  branchedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  completedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
