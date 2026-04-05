import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { Task } from '../entities/task.entity';

@Entity('workflow_columns')
export class WorkflowColumn extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: false })
  projectId: string;

  @Column({ type: 'varchar', length: 200, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  statusKey: string | null;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  @Column({ type: 'int', nullable: true })
  wipLimit: number | null;

  @Column({ type: 'boolean', default: false })
  locked: boolean;

  @OneToMany(() => Task, (task) => task.workflowColumn)
  tasks: Task[];
}
