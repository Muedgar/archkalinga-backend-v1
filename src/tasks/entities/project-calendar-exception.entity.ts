import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AppBaseEntity } from 'src/common/entities';
import { ProjectCalendar } from './project-calendar.entity';

@Entity('project_calendar_exceptions')
@Unique(['calendarId', 'date'])
export class ProjectCalendarException extends AppBaseEntity {
  @ManyToOne(() => ProjectCalendar, (calendar) => calendar.exceptions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'calendar_id', referencedColumnName: 'id' })
  calendar: ProjectCalendar;

  @Column({ name: 'calendar_id', type: 'uuid', nullable: false })
  calendarId: string;

  @Column({ type: 'date', nullable: false })
  date: string;

  @Column({ name: 'is_working_day', type: 'boolean', nullable: false })
  isWorkingDay: boolean;

  @Column({ type: 'varchar', length: 200, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;
}
