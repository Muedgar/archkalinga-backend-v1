import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';

@Entity('task_checklist_items')
export class TaskChecklistItem extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.checklistItems, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @Column({ type: 'varchar', length: 500, nullable: false })
  text: string;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  @Column({ type: 'uuid', nullable: true })
  completedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
