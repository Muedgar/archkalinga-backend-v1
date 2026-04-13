import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Organization } from 'src/organizations/entities/organization.entity';
import { TemplateTask } from './template-task.entity';

@Entity('templates')
@Unique(['organizationId', 'name'])
export class Template extends AppBaseEntity {
  @Column({ type: 'varchar', length: 80, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 800, nullable: false })
  description: string;

  @Column({ type: 'boolean', nullable: false, default: false })
  isDefault: boolean;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'uuid', nullable: false })
  organizationId: string;

  @OneToMany(() => TemplateTask, (task) => task.template, {
    cascade: ['insert', 'update'],
  })
  tasks: TemplateTask[];
}
