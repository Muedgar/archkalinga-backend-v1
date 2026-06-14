import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { Task } from './task.entity';
import { TaskScheduleExplanation } from './task-schedule-explanation.entity';

export enum ScheduleCalculationStatus {
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('task_schedule_calculation_runs')
export class TaskScheduleCalculationRun extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid', nullable: false })
  projectId: string;

  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'trigger_task_id', referencedColumnName: 'id' })
  triggerTask: Task | null;

  @Column({ name: 'trigger_task_id', type: 'uuid', nullable: true })
  triggerTaskId: string | null;

  @Column({
    name: 'trigger_type',
    type: 'varchar',
    length: 100,
    nullable: false,
  })
  triggerType: string;

  @Column({
    type: 'enum',
    enum: ScheduleCalculationStatus,
    enumName: 'task_schedule_calculation_status_enum',
    default: ScheduleCalculationStatus.RUNNING,
  })
  status: ScheduleCalculationStatus;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'summary_json', type: 'jsonb', default: {} })
  summaryJson: Record<string, unknown>;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @OneToMany(
    () => TaskScheduleExplanation,
    (explanation) => explanation.calculationRun,
  )
  explanations: TaskScheduleExplanation[];
}
