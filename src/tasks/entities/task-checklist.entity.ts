import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { SnakeCaseAppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';
import { TaskChecklistItem } from './task-checklist-item.entity';

@Entity('task_checklists')
export class TaskChecklist extends SnakeCaseAppBaseEntity {
  @ManyToOne(() => Task, (task) => task.checklistGroups, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ name: 'order_index', type: 'int', default: 0 })
  orderIndex: number;

  @OneToMany(() => TaskChecklistItem, (item) => item.checklistGroup)
  items: TaskChecklistItem[];
}
