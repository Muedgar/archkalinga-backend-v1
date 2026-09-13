import { Column, Entity, JoinColumn, ManyToOne, Unique, Check } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { TaskChecklistItem } from './task-checklist-item.entity';
import { DependencyType } from './task-dependency.entity';

@Entity('checklist_dependencies')
@Unique(['checklistItemId', 'dependsOnChecklistItemId'])
@Check('"checklist_item_id" <> "depends_on_checklist_item_id"')
export class ChecklistDependency extends AppBaseEntity {
  @ManyToOne(() => TaskChecklistItem, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'checklist_item_id', referencedColumnName: 'id' })
  checklistItem: TaskChecklistItem;
  @Column({ name: 'checklist_item_id', type: 'uuid' })
  checklistItemId: string;
  @ManyToOne(() => TaskChecklistItem, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'depends_on_checklist_item_id',
    referencedColumnName: 'id',
  })
  dependsOnChecklistItem: TaskChecklistItem;
  @Column({ name: 'depends_on_checklist_item_id', type: 'uuid' })
  dependsOnChecklistItemId: string;
  @Column({
    name: 'dependency_type',
    type: 'varchar',
    length: 2,
    default: 'FS',
  })
  dependencyType: DependencyType;
  @Column({ name: 'lag_days', type: 'int', default: 0 })
  lagDays: number;
}
