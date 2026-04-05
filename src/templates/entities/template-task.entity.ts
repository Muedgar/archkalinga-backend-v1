import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Template } from './template.entity';

@Entity('template_tasks')
@Unique(['templateId', 'parentTaskId', 'order'])
export class TemplateTask extends AppBaseEntity {
  @Column({ type: 'varchar', length: 120, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: false })
  description: string;

  @Column({ type: 'integer', nullable: false })
  order: number;

  @ManyToOne(() => Template, (template) => template.tasks, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'template_id' })
  template: Template;

  @Column({ type: 'uuid', nullable: false })
  templateId: string;

  @ManyToOne(() => TemplateTask, (task) => task.subtasks, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_task_id' })
  parentTask: TemplateTask | null;

  @Column({ type: 'uuid', nullable: true })
  parentTaskId: string | null;

  @OneToMany(() => TemplateTask, (task) => task.parentTask)
  subtasks: TemplateTask[];
}
