import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';

const numericTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('task_resource_allocations')
@Index('idx_task_resource_allocations_task', ['taskId'])
@Index('idx_task_resource_allocations_hierarchy', [
  'phaseCode',
  'stageCode',
  'activityCode',
])
@Index('idx_task_resource_allocations_activity_code', ['activityCode'])
@Index('idx_task_resource_allocations_resource', ['resourceType', 'resourceName'])
export class TaskResourceAllocation extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.resourceAllocations, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @Column({ name: 'phase_code', type: 'varchar', length: 100, nullable: true })
  phaseCode: string | null;

  @Column({ name: 'phase_name', type: 'varchar', length: 500, nullable: true })
  phaseName: string | null;

  @Column({ name: 'stage_code', type: 'varchar', length: 100, nullable: true })
  stageCode: string | null;

  @Column({ name: 'stage_name', type: 'varchar', length: 500, nullable: true })
  stageName: string | null;

  @Column({ name: 'activity_code', type: 'varchar', length: 100, nullable: true })
  activityCode: string | null;

  @Column({ name: 'activity_name', type: 'varchar', length: 500, nullable: true })
  activityName: string | null;

  @Column({ name: 'resource_type', type: 'varchar', length: 100, nullable: false })
  resourceType: string;

  @Column({ name: 'resource_name', type: 'varchar', length: 255, nullable: false })
  resourceName: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: false,
    transformer: numericTransformer,
  })
  quantity: number;

  @Column({
    name: 'duration_days',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  durationDays: number | null;

  @Column({
    name: 'default_rate',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  defaultRate: number | null;

  @Column({
    name: 'override_rate',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  overrideRate: number | null;

  @Column({
    name: 'effective_rate',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  effectiveRate: number | null;

  @Column({
    name: 'cost_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  costAmount: number | null;

  @Column({ type: 'varchar', length: 3, default: 'RWF' })
  currency: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  status: string | null;
}
