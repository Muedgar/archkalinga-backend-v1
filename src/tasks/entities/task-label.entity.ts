import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { LegacyUuidEntity } from 'src/common/entities';
import { ProjectLabel } from '../project-config';
import { Task } from './task.entity';

@Entity('task_labels')
@Unique(['taskId', 'labelId'])
export class TaskLabel extends LegacyUuidEntity {
  @ManyToOne(() => Task, (task) => task.labels, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => ProjectLabel, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'label_id' })
  label: ProjectLabel;

  @Column({ type: 'uuid', nullable: false })
  labelId: string;
}
