import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';

const numericTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('task_materials')
@Index('idx_task_materials_task', ['taskId'])
@Index('idx_task_materials_hierarchy', [
  'phaseCode',
  'stageCode',
  'activityCode',
  'taskCode',
])
@Index('idx_task_materials_activity_code', ['activityCode'])
@Index('idx_task_materials_material', ['materialCategory', 'materialName'])
export class TaskMaterial extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.materials, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @Column({ name: 'phase_code', type: 'varchar', length: 100, nullable: true })
  phaseCode: string | null;

  @Column({ name: 'stage_code', type: 'varchar', length: 100, nullable: true })
  stageCode: string | null;

  @Column({ name: 'activity_code', type: 'varchar', length: 100, nullable: true })
  activityCode: string | null;

  @Column({ name: 'activity_name', type: 'varchar', length: 500, nullable: true })
  activityName: string | null;

  @Column({ name: 'task_code', type: 'varchar', length: 100, nullable: true })
  taskCode: string | null;

  @Column({ name: 'task_name', type: 'varchar', length: 500, nullable: true })
  taskName: string | null;

  @Column({
    name: 'material_category',
    type: 'varchar',
    length: 100,
    nullable: false,
  })
  materialCategory: string;

  @Column({ name: 'material_name', type: 'varchar', length: 255, nullable: false })
  materialName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit: string | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: false,
    transformer: numericTransformer,
  })
  quantity: number;

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
    name: 'waste_percent',
    type: 'numeric',
    precision: 8,
    scale: 4,
    nullable: true,
    transformer: numericTransformer,
  })
  wastePercent: number | null;

  @Column({
    name: 'material_cost',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  materialCost: number | null;

  @Column({ type: 'varchar', length: 3, default: 'RWF' })
  currency: string;

  @Column({ name: 'lookup_status', type: 'varchar', length: 50, nullable: true })
  lookupStatus: string | null;
}
