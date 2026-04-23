import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { LegacyUuidEntity } from 'src/common/entities';
import { Task } from './task.entity';

export enum ViewType {
  MINDMAP = 'mindmap',
  GANTT = 'gantt',
}

@Entity('task_view_metadata')
@Unique(['taskId', 'viewType'])
export class TaskViewMetadata extends LegacyUuidEntity {
  @ManyToOne(() => Task, (task) => task.viewMetadataEntries, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @Column({ type: 'enum', enum: ViewType, nullable: false })
  viewType: ViewType;

  @Column({ name: 'meta', type: 'jsonb', default: {} })
  metaJson: Record<string, unknown>;
}
