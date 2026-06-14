import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Task } from './task.entity';
import { TaskScheduleCalculationRun } from './task-schedule-calculation-run.entity';

@Entity('task_schedule_explanations')
@Unique(['calculationRunId', 'taskId'])
export class TaskScheduleExplanation extends AppBaseEntity {
  @ManyToOne(() => TaskScheduleCalculationRun, (run) => run.explanations, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'calculation_run_id', referencedColumnName: 'id' })
  calculationRun: TaskScheduleCalculationRun;

  @Column({ name: 'calculation_run_id', type: 'uuid', nullable: false })
  calculationRunId: string;

  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id', referencedColumnName: 'id' })
  task: Task;

  @Column({ name: 'task_id', type: 'uuid', nullable: false })
  taskId: string;

  @Column({ name: 'is_critical', type: 'boolean', default: false })
  isCritical: boolean;

  @Column({ name: 'driving_predecessor_ids', type: 'jsonb', default: [] })
  drivingPredecessorIds: string[];

  @Column({ name: 'successor_pressure_ids', type: 'jsonb', default: [] })
  successorPressureIds: string[];

  @Column({ name: 'explanation_json', type: 'jsonb', default: {} })
  explanationJson: Record<string, unknown>;
}
