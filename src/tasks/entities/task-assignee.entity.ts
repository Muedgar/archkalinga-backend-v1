import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { LegacyUuidEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';

export enum AssignmentRole {
  ASSIGNEE = 'ASSIGNEE',
  REPORTER = 'REPORTER',
}

@Entity('task_assignees')
@Unique(['taskId', 'userId'])
export class TaskAssignee extends LegacyUuidEntity {
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

  @Column({ type: 'uuid', nullable: true })
  projectRoleId: string | null;

  @Column({
    type: 'enum',
    enum: AssignmentRole,
    default: AssignmentRole.ASSIGNEE,
  })
  assignmentRole: AssignmentRole;
}
