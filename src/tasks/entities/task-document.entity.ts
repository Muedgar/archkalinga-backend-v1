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
@Index('idx_task_documents_updated_by', ['updatedByUserId'])
@Index('idx_task_documents_source_task', ['sourceTaskId'])
@Index('idx_task_documents_source_document', ['sourceDocumentId'])
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

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_user_id', referencedColumnName: 'id' })
  updatedByUser: User | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_task_id', referencedColumnName: 'id' })
  sourceTask: Task | null;

  @Column({ name: 'source_task_id', type: 'uuid', nullable: true })
  sourceTaskId: string | null;

  @ManyToOne(() => TaskDocument, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_document_id', referencedColumnName: 'id' })
  sourceDocument: TaskDocument | null;

  @Column({ name: 'source_document_id', type: 'uuid', nullable: true })
  sourceDocumentId: string | null;

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
