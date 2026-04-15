import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { TemplateTask } from './template-task.entity';

@Entity('templates')
@Unique(['workspaceId', 'name'])
export class Template extends AppBaseEntity {
  @Column({ type: 'varchar', length: 80, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 800, nullable: false })
  description: string;

  @Column({ type: 'boolean', nullable: false, default: false })
  isDefault: boolean;

  @ManyToOne(() => Workspace, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'uuid', nullable: false })
  workspaceId: string;

  @OneToMany(() => TemplateTask, (task) => task.template, {
    cascade: ['insert', 'update'],
  })
  tasks: TemplateTask[];
}
