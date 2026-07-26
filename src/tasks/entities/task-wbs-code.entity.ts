import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { User } from 'src/users/entities';
import { Task } from './task.entity';

@Entity('task_wbs_codes')
@Index('idx_task_wbs_codes_project_code_unique', ['projectId', 'wbsCode'], {
  unique: true,
})
@Index('idx_task_wbs_codes_task', ['taskId'])
export class TaskWbsCode extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ name: 'wbs_code', type: 'varchar', length: 100, nullable: false })
  wbsCode: string;

  @Column({
    name: 'wbs_sort_key',
    type: 'varchar',
    length: 500,
    nullable: false,
  })
  wbsSortKey: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_user_id', referencedColumnName: 'id' })
  assignedByUser: User | null;

  @Column({ name: 'assigned_by_user_id', type: 'uuid', nullable: true })
  assignedByUserId: string | null;
}
