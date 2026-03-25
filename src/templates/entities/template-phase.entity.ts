import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Template } from './template.entity';

@Entity('template_phases')
@Unique(['templateId', 'order'])
export class TemplatePhase extends AppBaseEntity {
  @Column({ type: 'varchar', length: 80, nullable: false })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: false })
  description: string;

  @Column({ type: 'integer', nullable: false })
  order: number;

  @ManyToOne(() => Template, (template) => template.phases, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'template_id' })
  template: Template;

  @Column({ type: 'uuid', nullable: false })
  templateId: string;
}
