import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { Project } from 'src/projects/entities';
import { User } from 'src/users/entities';
import { ProjectCalendarException } from './project-calendar-exception.entity';

@Entity('project_calendars')
@Unique(['projectId'])
export class ProjectCalendar extends AppBaseEntity {
  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id', referencedColumnName: 'id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid', nullable: false })
  projectId: string;

  @Column({ type: 'varchar', length: 100, default: 'Africa/Kigali' })
  timezone: string;

  @Column({ name: 'working_weekdays', type: 'jsonb', default: [1, 2, 3, 4, 5] })
  workingWeekdays: number[];

  @Column({
    name: 'default_hours_per_day',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 8,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  defaultHoursPerDay: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id', referencedColumnName: 'id' })
  createdByUser: User | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @OneToMany(() => ProjectCalendarException, (exception) => exception.calendar)
  exceptions: ProjectCalendarException[];
}
