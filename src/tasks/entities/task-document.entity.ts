import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';
import { TaskDocumentAttachment } from './task-document-attachment.entity';

export enum TaskDocumentType {
  STARTER = 'STARTER',
  DELIVERABLE = 'DELIVERABLE',
}

@Entity('task_documents')
@Index('idx_task_documents_task_type', ['taskId', 'type'])
@Index('idx_task_documents_created_by', ['createdByUserId'])
export class TaskDocument extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.documents, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id', referencedColumnName: 'id' })
  createdByUser: User;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: false })
  createdByUserId: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: TaskDocumentType,
    enumName: 'task_documents_type_enum',
    nullable: false,
  })
  type: TaskDocumentType;

  @OneToMany(
    () => TaskDocumentAttachment,
    (attachment) => attachment.document,
    {
      cascade: ['insert', 'update'],
    },
  )
  attachments: TaskDocumentAttachment[];
}
