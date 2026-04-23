import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { SnakeCaseAppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';

@Entity('task_watchers')
@Unique(['taskId', 'userId'])
export class TaskWatcher extends SnakeCaseAppBaseEntity {
  @ManyToOne(() => Task, (task) => task.watchers, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid', nullable: false })
  userId: string;
}
