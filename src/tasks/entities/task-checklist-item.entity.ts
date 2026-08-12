import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
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
