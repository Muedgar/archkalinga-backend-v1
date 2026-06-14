import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities';
import {
  CreateProjectCalendarExceptionDto,
  UpdateProjectCalendarExceptionDto,
  UpsertProjectCalendarDto,
} from '../dtos';
import { ProjectCalendar, ProjectCalendarException } from '../entities';

@Injectable()
export class ProjectCalendarService {
  constructor(
    @InjectRepository(ProjectCalendar)
    private readonly calendarRepo: Repository<ProjectCalendar>,
    @InjectRepository(ProjectCalendarException)
    private readonly exceptionRepo: Repository<ProjectCalendarException>,
  ) {}

  async getCalendar(projectId: string) {
    const calendar = await this.calendarRepo.findOne({
      where: { projectId },
      relations: ['exceptions'],
    });
    return calendar ?? this.defaultCalendar(projectId);
  }

  async upsertCalendar(
    projectId: string,
    dto: UpsertProjectCalendarDto,
    actorUser: User,
  ) {
    this.assertUniqueWeekdays(dto.workingWeekdays);
    let calendar = await this.calendarRepo.findOne({ where: { projectId } });
    if (!calendar) {
      calendar = this.calendarRepo.create({
        projectId,
        timezone: dto.timezone?.trim() || 'Africa/Kigali',
        workingWeekdays: dto.workingWeekdays ?? [1, 2, 3, 4, 5],
        defaultHoursPerDay: dto.defaultHoursPerDay ?? 8,
        createdByUserId: actorUser.id,
      });
    } else {
      if (dto.timezone !== undefined) {
        calendar.timezone = dto.timezone.trim();
      }
      if (dto.workingWeekdays !== undefined) {
        calendar.workingWeekdays = dto.workingWeekdays;
      }
      if (dto.defaultHoursPerDay !== undefined) {
        calendar.defaultHoursPerDay = dto.defaultHoursPerDay;
      }
      if (!calendar.createdByUserId) {
        calendar.createdByUserId = actorUser.id;
      }
    }

    return this.calendarRepo.save(calendar);
  }

  async listExceptions(projectId: string) {
    const calendar = await this.ensureCalendar(projectId);
    return this.exceptionRepo.find({
      where: { calendarId: calendar.id },
      order: { date: 'ASC', createdAt: 'ASC' },
    });
  }

  async createException(
    projectId: string,
    dto: CreateProjectCalendarExceptionDto,
  ) {
    const calendar = await this.ensureCalendar(projectId);
    const existing = await this.exceptionRepo.findOne({
      where: { calendarId: calendar.id, date: dto.date },
    });
    if (existing) {
      throw new BadRequestException(
        'A calendar exception already exists for this date',
      );
    }
    return this.exceptionRepo.save(
      this.exceptionRepo.create({
        calendarId: calendar.id,
        date: dto.date,
        isWorkingDay: dto.isWorkingDay,
        name: dto.name.trim(),
        reason: dto.reason?.trim() || null,
      }),
    );
  }

  async updateException(
    projectId: string,
    exceptionId: string,
    dto: UpdateProjectCalendarExceptionDto,
  ) {
    const calendar = await this.ensureCalendar(projectId);
    const exception = await this.exceptionRepo.findOne({
      where: { id: exceptionId, calendarId: calendar.id },
    });
    if (!exception) {
      throw new NotFoundException('Calendar exception not found');
    }

    if (dto.date !== undefined && dto.date !== exception.date) {
      const duplicate = await this.exceptionRepo.findOne({
        where: { calendarId: calendar.id, date: dto.date },
      });
      if (duplicate) {
        throw new BadRequestException(
          'A calendar exception already exists for this date',
        );
      }
      exception.date = dto.date;
    }
    if (dto.isWorkingDay !== undefined) {
      exception.isWorkingDay = dto.isWorkingDay;
    }
    if (dto.name !== undefined) {
      exception.name = dto.name.trim();
    }
    if (dto.reason !== undefined) {
      exception.reason = dto.reason?.trim() || null;
    }

    return this.exceptionRepo.save(exception);
  }

  async deleteException(projectId: string, exceptionId: string) {
    const calendar = await this.ensureCalendar(projectId);
    const exception = await this.exceptionRepo.findOne({
      where: { id: exceptionId, calendarId: calendar.id },
    });
    if (!exception) {
      throw new NotFoundException('Calendar exception not found');
    }
    await this.exceptionRepo.delete({ id: exception.id });
    return { deleted: true, id: exception.id };
  }

  private async ensureCalendar(projectId: string): Promise<ProjectCalendar> {
    const calendar = await this.calendarRepo.findOne({ where: { projectId } });
    if (!calendar) {
      throw new BadRequestException(
        'Project calendar does not exist. Create the calendar before managing exceptions.',
      );
    }
    return calendar;
  }

  private defaultCalendar(projectId: string) {
    return {
      id: null,
      projectId,
      timezone: 'Africa/Kigali',
      workingWeekdays: [1, 2, 3, 4, 5],
      defaultHoursPerDay: 8,
      createdByUserId: null,
      exceptions: [],
    };
  }

  private assertUniqueWeekdays(weekdays?: number[]) {
    if (!weekdays) return;
    if (new Set(weekdays).size !== weekdays.length) {
      throw new BadRequestException(
        'workingWeekdays cannot contain duplicates',
      );
    }
  }
}
