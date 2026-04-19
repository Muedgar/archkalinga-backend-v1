import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';
import { TaskChecklistItem } from './task-checklist-item.entity';

@Entity('task_checklists')
export class TaskChecklist extends AppBaseEntity {
  @ManyToOne(() => Task, (task) => task.checklistGroups, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid', nullable: false })
  taskId: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  @OneToMany(() => TaskChecklistItem, (item) => item.checklistGroup)
  items: TaskChecklistItem[];
}
