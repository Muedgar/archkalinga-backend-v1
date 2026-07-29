import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';
import { TaskLocationProgress } from './task-location-progress.entity';

const numericTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('task_locations')
@Index('idx_task_locations_task_order', ['taskId', 'orderIndex'])
@Index('idx_task_locations_task_code_unique', ['taskId', 'locationCode'], {
  unique: true,
  where: '"location_code" IS NOT NULL',
})
export class TaskLocation extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.locations, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @Column({
    name: 'location_code',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  locationCode: string | null;

  @Column({
    name: 'location_name',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  locationName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'planned_quantity',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  plannedQuantity: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit: string | null;

  @Column({ name: 'order_index', type: 'int', default: 0 })
  orderIndex: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => TaskLocationProgress, (progress) => progress.location)
  progressEntries: TaskLocationProgress[];
}
