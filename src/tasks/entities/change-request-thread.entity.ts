import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';
import { ChangeRequest } from './change-request.entity';
import { ChangeRequestThreadMessage } from './change-request-thread-message.entity';

@Entity('change_request_threads')
@Index('idx_change_request_threads_project', ['projectId'])
@Index('idx_change_request_threads_task', ['taskId'])
export class ChangeRequestThread extends AppBaseEntity {
  @OneToOne(() => ChangeRequest, (changeRequest) => changeRequest.thread, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'change_request_id', referencedColumnName: 'id' })
  changeRequest: ChangeRequest;

  @Column({ name: 'change_request_id', type: 'uuid', nullable: false })
  changeRequestId: string;

  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id', referencedColumnName: 'id' })
  createdByUser: User;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: false })
  createdByUserId: string;

  @OneToMany(() => ChangeRequestThreadMessage, (message) => message.thread)
  messages: ChangeRequestThreadMessage[];
}
