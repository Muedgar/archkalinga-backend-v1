import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities';
import {
  Task,
  TaskActionType,
  TaskActivitySchedule,
  TaskScheduleOverride,
} from '../entities';
import { UpdateActivityScheduleDto } from '../dtos';
import { TaskActivityScheduleDetailSerializer } from '../serializers';
import { TaskActivityService } from './task-activity.service';

@Injectable()
export class TaskActivityScheduleService {
  constructor(
    @InjectRepository(TaskActivitySchedule)
    private readonly scheduleRepo: Repository<TaskActivitySchedule>,
    @InjectRepository(TaskScheduleOverride)
    private readonly overrideRepo: Repository<TaskScheduleOverride>,
    private readonly activitySvc: TaskActivityService,
  ) {}

  private serialize(
    schedule: Partial<TaskActivitySchedule>,
  ): TaskActivityScheduleDetailSerializer {
    return plainToInstance(TaskActivityScheduleDetailSerializer, schedule, {
      excludeExtraneousValues: true,
    });
  }

  async getForTask(
    taskId: string,
  ): Promise<TaskActivityScheduleDetailSerializer | null> {
    const schedule = await this.scheduleRepo.findOne({ where: { taskId } });
    return schedule ? this.serialize(schedule) : null;
  }

  async upsertForTask(
    task: Task,
    actorUser: User,
    dto: UpdateActivityScheduleDto,
  ): Promise<TaskActivityScheduleDetailSerializer> {
    this.ensureDateRange(dto.plannedStartDate, dto.plannedEndDate, 'planned');
    this.ensureDateRange(dto.actualStartDate, dto.actualEndDate, 'actual');

    const existing = await this.scheduleRepo.findOne({
      where: { taskId: task.id },
    });
    const schedule =
      existing ??
      this.scheduleRepo.create({
        task,
        taskId: task.id,
        isCritical: false,
        isManuallyScheduled: false,
      });

    const nextIsManual =
      dto.isManuallyScheduled ?? schedule.isManuallyScheduled ?? false;
    const manualReason =
      dto.manualReason !== undefined
        ? (dto.manualReason?.trim() ?? null)
        : schedule.manualReason;

    const manualDateFieldsChanged = this.hasManualDateFieldChanges(
      schedule,
      dto,
    );
    if (manualDateFieldsChanged && !nextIsManual) {
      throw new BadRequestException(
        'isManuallyScheduled must be true when manually changing planned schedule dates',
      );
    }
    if (nextIsManual && !manualReason) {
      throw new BadRequestException(
        'manualReason is required when manually pinning activity schedule dates',
      );
    }

    const overrideEntries = this.buildOverrideEntries(
      task,
      actorUser,
      schedule,
      dto,
      manualReason,
      nextIsManual,
    );

    if (dto.durationDays !== undefined) {
      schedule.durationDays = dto.durationDays ?? null;
    }
    if (dto.plannedStartDate !== undefined) {
      schedule.plannedStartDate = dto.plannedStartDate ?? null;
    }
    if (dto.plannedEndDate !== undefined) {
      schedule.plannedEndDate = dto.plannedEndDate ?? null;
    }
    if (dto.actualStartDate !== undefined) {
      schedule.actualStartDate = dto.actualStartDate ?? null;
    }
    if (dto.actualEndDate !== undefined) {
      schedule.actualEndDate = dto.actualEndDate ?? null;
    }
    if (dto.isManuallyScheduled !== undefined) {
      schedule.isManuallyScheduled = dto.isManuallyScheduled;
    }
    if (dto.manualReason !== undefined) {
      schedule.manualReason = manualReason;
    }

    return this.scheduleRepo.manager.transaction(async (tx) => {
      const saved = await tx.save(TaskActivitySchedule, schedule);
      if (overrideEntries.length) {
        await tx.save(TaskScheduleOverride, overrideEntries);
      }
      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          operation: 'activity_schedule_updated',
          activityScheduleId: saved.id,
          changedFields: this.changedFields(dto),
          manualOverrideRecorded: overrideEntries.length > 0,
        },
      );
      return this.serialize(saved);
    });
  }

  private ensureDateRange(
    startDate: string | null | undefined,
    endDate: string | null | undefined,
    label: 'planned' | 'actual',
  ): void {
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
      throw new BadRequestException(
        `${label}StartDate must be before or equal to ${label}EndDate`,
      );
    }
  }

  private hasManualDateFieldChanges(
    schedule: TaskActivitySchedule,
    dto: UpdateActivityScheduleDto,
  ): boolean {
    return (
      this.changed(schedule.plannedStartDate, dto.plannedStartDate) ||
      this.changed(schedule.plannedEndDate, dto.plannedEndDate)
    );
  }

  private buildOverrideEntries(
    task: Task,
    actorUser: User,
    schedule: TaskActivitySchedule,
    dto: UpdateActivityScheduleDto,
    manualReason: string | null,
    nextIsManual: boolean,
  ): TaskScheduleOverride[] {
    if (!nextIsManual || !manualReason) return [];

    const entries: TaskScheduleOverride[] = [];
    this.pushOverride(entries, task, actorUser, manualReason, {
      fieldName: 'durationDays',
      oldValue: schedule.durationDays,
      newValue: dto.durationDays,
    });
    this.pushOverride(entries, task, actorUser, manualReason, {
      fieldName: 'plannedStartDate',
      oldValue: schedule.plannedStartDate,
      newValue: dto.plannedStartDate,
    });
    this.pushOverride(entries, task, actorUser, manualReason, {
      fieldName: 'plannedEndDate',
      oldValue: schedule.plannedEndDate,
      newValue: dto.plannedEndDate,
    });

    return entries;
  }

  private pushOverride(
    entries: TaskScheduleOverride[],
    task: Task,
    actorUser: User,
    reason: string,
    change: {
      fieldName: string;
      oldValue: string | number | null;
      newValue: string | number | null | undefined;
    },
  ): void {
    if (change.newValue === undefined) return;
    if (!this.changed(change.oldValue, change.newValue)) return;

    entries.push(
      this.overrideRepo.create({
        task,
        taskId: task.id,
        fieldName: change.fieldName,
        oldValue: { value: change.oldValue },
        newValue: { value: change.newValue },
        reason,
        createdByUser: actorUser,
        createdByUserId: actorUser.id,
      }),
    );
  }

  private changed(
    oldValue: string | number | null,
    newValue: string | number | null | undefined,
  ): boolean {
    return newValue !== undefined && oldValue !== (newValue ?? null);
  }

  private changedFields(dto: UpdateActivityScheduleDto): string[] {
    return [
      'durationDays',
      'plannedStartDate',
      'plannedEndDate',
      'actualStartDate',
      'actualEndDate',
      'isManuallyScheduled',
      'manualReason',
    ].filter((field) => dto[field] !== undefined);
  }
}
