import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { TaskLocation } from './task-location.entity';

const numericTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('task_location_progress')
@Index('idx_task_location_progress_location_unique', ['taskLocationId'], {
  unique: true,
})
export class TaskLocationProgress extends AppBaseEntity {
  @ManyToOne(() => TaskLocation, (location) => location.progressEntries, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_location_id', referencedColumnName: 'id' })
  location: TaskLocation;

  @Column({ name: 'task_location_id', type: 'uuid', nullable: false })
  taskLocationId: string;

  @Column({ type: 'smallint', nullable: true })
  progress: number | null;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  status: string | null;

  @Column({
    name: 'actual_quantity',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  actualQuantity: number | null;

  @Column({ name: 'site_note', type: 'text', nullable: true })
  siteNote: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_user_id', referencedColumnName: 'id' })
  updatedByUser: User | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @Column({ name: 'reported_at', type: 'timestamptz', nullable: true })
  reportedAt: Date | null;
}
