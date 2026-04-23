import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { LegacyUuidEntity } from 'src/common/entities';
import { Task } from './task.entity';

export enum DependencyType {
  FINISH_TO_START = 'FS',
  START_TO_START = 'SS',
  FINISH_TO_FINISH = 'FF',
  START_TO_FINISH = 'SF',
}

@Entity('task_dependencies')
@Unique(['taskId', 'dependsOnTaskId'])
export class TaskDependency extends LegacyUuidEntity {
  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'depends_on_id' })
  dependsOnTask: Task;

  @Column({ type: 'uuid', nullable: false })
  dependsOnTaskId: string;

  @Column({
    type: 'enum',
    enum: DependencyType,
    default: DependencyType.FINISH_TO_START,
  })
  dependencyType: DependencyType;

  @Column({ type: 'int', nullable: true })
  lagDays: number | null;
}
