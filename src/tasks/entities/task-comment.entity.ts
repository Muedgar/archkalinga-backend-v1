import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';

@Entity('task_comments')
export class TaskComment extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.comments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_id' })
  authorUser: User;

  @Column({ name: 'authorUserId', type: 'uuid', nullable: false })
  authorUserId: string;

  @Column({ type: 'text', nullable: false })
  body: string;

  @Column({ name: 'parentCommentId', type: 'uuid', nullable: true })
  parentCommentId: string | null;

  @Column({ name: 'deletedAt', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
