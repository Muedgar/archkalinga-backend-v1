import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';

export enum RelationType {
  RELATES_TO = 'RELATES_TO',
  BLOCKS = 'BLOCKS',
  DUPLICATES = 'DUPLICATES',
  CLONES = 'CLONES',
}

@Entity('task_relations')
@Unique(['taskId', 'relatedTaskId'])
export class TaskRelation extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.outgoingRelations, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @ManyToOne(() => Task, (task) => task.incomingRelations, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'related_task_id' })
  relatedTask: Task;

  @Column({ type: 'uuid', nullable: false })
  relatedTaskId: string;

  @Column({
    type: 'enum',
    enum: RelationType,
    default: RelationType.RELATES_TO,
  })
  relationType: RelationType;
}
