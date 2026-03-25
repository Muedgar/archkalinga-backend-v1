import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Organization } from 'src/organizations/entities/organization.entity';
import { TemplatePhase } from './template-phase.entity';

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

  @OneToMany(() => TemplatePhase, (phase) => phase.template, {
    cascade: ['insert', 'update'],
  })
  phases: TemplatePhase[];
}
