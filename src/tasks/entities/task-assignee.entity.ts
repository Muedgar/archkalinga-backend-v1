import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';

export enum AssignmentRole {
  OWNER = 'OWNER',
  CONTRIBUTOR = 'CONTRIBUTOR',
  REVIEWER = 'REVIEWER',
}

@Entity('task_assignees')
@Unique(['taskId', 'userId'])
export class TaskAssignee extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.assignees, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @Column({
    type: 'enum',
    enum: AssignmentRole,
    default: AssignmentRole.CONTRIBUTOR,
  })
  assignmentRole: AssignmentRole;
}
