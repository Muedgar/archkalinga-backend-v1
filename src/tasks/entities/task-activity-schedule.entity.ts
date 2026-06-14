import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';

const numericTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('task_activity_schedules')
@Unique(['taskId'])
export class TaskActivitySchedule extends AppBaseEntity {
  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @Column({
    name: 'duration_days',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  durationDays: number | null;

  @Column({ name: 'planned_start_date', type: 'date', nullable: true })
  plannedStartDate: string | null;

  @Column({ name: 'planned_end_date', type: 'date', nullable: true })
  plannedEndDate: string | null;

  @Column({
    name: 'planned_start_offset',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  plannedStartOffset: number | null;

  @Column({
    name: 'planned_end_offset',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  plannedEndOffset: number | null;

  @Column({ name: 'actual_start_date', type: 'date', nullable: true })
  actualStartDate: string | null;

  @Column({ name: 'actual_end_date', type: 'date', nullable: true })
  actualEndDate: string | null;

  @Column({
    name: 'early_start_offset',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  earlyStartOffset: number | null;

  @Column({
    name: 'early_finish_offset',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  earlyFinishOffset: number | null;

  @Column({
    name: 'late_start_offset',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  lateStartOffset: number | null;

  @Column({
    name: 'late_finish_offset',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  lateFinishOffset: number | null;

  @Column({ name: 'early_start_date', type: 'date', nullable: true })
  earlyStartDate: string | null;

  @Column({ name: 'early_finish_date', type: 'date', nullable: true })
  earlyFinishDate: string | null;

  @Column({ name: 'late_start_date', type: 'date', nullable: true })
  lateStartDate: string | null;

  @Column({ name: 'late_finish_date', type: 'date', nullable: true })
  lateFinishDate: string | null;

  @Column({
    name: 'total_float_days',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  totalFloatDays: number | null;

  @Column({
    name: 'free_float_days',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  freeFloatDays: number | null;

  @Column({ name: 'is_critical', type: 'boolean', default: false })
  isCritical: boolean;

  @Column({ name: 'is_manually_scheduled', type: 'boolean', default: false })
  isManuallyScheduled: boolean;

  @Column({ name: 'manual_reason', type: 'text', nullable: true })
  manualReason: string | null;

  @Column({ name: 'calculated_at', type: 'timestamptz', nullable: true })
  calculatedAt: Date | null;
}
