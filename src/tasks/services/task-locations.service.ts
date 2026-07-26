import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from 'src/users/entities';
import {
  Task,
  TaskActionType,
  TaskLocation,
  TaskLocationProgress,
} from '../entities';
import { CreateTaskLocationsDto, UpdateTaskLocationProgressDto } from '../dtos';
import {
  TASK_LOCATION_CODE_ALREADY_EXISTS,
  TASK_LOCATION_NOT_FOUND,
} from '../messages';
import { TaskActivityService } from './task-activity.service';

type TaskLocationView = {
  id: string;
  taskId: string;
  locationCode: string | null;
  locationName: string;
  description: string | null;
  plannedQuantity: number | null;
  unit: string | null;
  orderIndex: number;
  isActive: boolean;
  progress: {
    id: string;
    progress: number | null;
    completed: boolean;
    status: string | null;
    actualQuantity: number | null;
    siteNote: string | null;
    updatedByUserId: string | null;
    reportedAt: Date | null;
    updatedAt: Date;
  } | null;
};

export type TaskLocationListResponse = {
  items: TaskLocationView[];
  summary: {
    locationCount: number;
    completedLocationCount: number;
    progressAverage: number | null;
    actualQuantityTotal: number;
    plannedQuantityTotal: number;
  };
};

@Injectable()
export class TaskLocationsService {
  constructor(
    @InjectRepository(TaskLocation)
    private readonly locationRepo: Repository<TaskLocation>,
    @InjectRepository(TaskLocationProgress)
    private readonly progressRepo: Repository<TaskLocationProgress>,
    private readonly activitySvc: TaskActivityService,
  ) {}

  async list(task: Task): Promise<TaskLocationListResponse> {
    const locations = await this.locationRepo.find({
      where: { taskId: task.id, isActive: true },
      relations: ['progressEntries'],
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });

    return this.buildListResponse(locations);
  }

  async createMany(
    task: Task,
    actorUser: User,
    dto: CreateTaskLocationsDto,
  ): Promise<TaskLocationListResponse> {
    const requestedCodes = dto.locations
      .map((location) => location.locationCode?.trim() || null)
      .filter((code): code is string => Boolean(code));
    if (new Set(requestedCodes).size !== requestedCodes.length) {
      throw new BadRequestException(TASK_LOCATION_CODE_ALREADY_EXISTS);
    }

    const existingCodes = requestedCodes.length
      ? await this.locationRepo.find({
          where: { taskId: task.id, locationCode: In(requestedCodes) },
          select: ['id', 'locationCode'],
        })
      : [];
    if (existingCodes.length) {
      throw new BadRequestException(TASK_LOCATION_CODE_ALREADY_EXISTS);
    }

    await this.locationRepo.manager.transaction(async (tx) => {
      const currentCount = await tx.count(TaskLocation, {
        where: { taskId: task.id },
      });

      const saved = await tx.save(
        dto.locations.map((location, index) =>
          tx.create(TaskLocation, {
            task,
            taskId: task.id,
            locationCode: location.locationCode?.trim() || null,
            locationName: location.locationName.trim(),
            description: location.description?.trim() || null,
            plannedQuantity: location.plannedQuantity ?? null,
            unit: location.unit?.trim() || null,
            orderIndex: location.orderIndex ?? currentCount + index,
            isActive: true,
          }),
        ),
      );

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          operation: 'task_locations_created',
          locationIds: saved.map((location) => location.id),
          locationCount: saved.length,
        },
      );
    });

    return this.list(task);
  }

  async updateProgress(
    task: Task,
    locationId: string,
    actorUser: User,
    dto: UpdateTaskLocationProgressDto,
  ): Promise<TaskLocationView> {
    const location = await this.locationRepo.findOne({
      where: { id: locationId, taskId: task.id, isActive: true },
      relations: ['progressEntries'],
    });
    if (!location) throw new NotFoundException(TASK_LOCATION_NOT_FOUND);

    let savedProgress: TaskLocationProgress;
    await this.progressRepo.manager.transaction(async (tx) => {
      const progress =
        (await tx.findOne(TaskLocationProgress, {
          where: { taskLocationId: location.id },
        })) ??
        tx.create(TaskLocationProgress, {
          location,
          taskLocationId: location.id,
          progress: null,
          completed: false,
          status: null,
          actualQuantity: null,
          siteNote: null,
          updatedByUserId: null,
          reportedAt: null,
        });

      if (dto.progress !== undefined) progress.progress = dto.progress ?? null;
      if (dto.completed !== undefined) progress.completed = dto.completed;
      if (dto.status !== undefined)
        progress.status = dto.status?.trim() || null;
      if (dto.actualQuantity !== undefined) {
        progress.actualQuantity = dto.actualQuantity ?? null;
      }
      if (dto.siteNote !== undefined) {
        progress.siteNote = dto.siteNote?.trim() || null;
      }
      if (dto.reportedAt !== undefined) {
        progress.reportedAt = dto.reportedAt ? new Date(dto.reportedAt) : null;
      } else {
        progress.reportedAt = new Date();
      }
      progress.updatedByUser = actorUser;
      progress.updatedByUserId = actorUser.id;

      savedProgress = await tx.save(TaskLocationProgress, progress);

      await this.activitySvc.log(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          operation: 'task_location_progress_updated',
          locationId: location.id,
          progress: savedProgress.progress,
          completed: savedProgress.completed,
          status: savedProgress.status,
        },
      );
    });

    location.progressEntries = [savedProgress!];
    return this.toLocationView(location);
  }

  private buildListResponse(
    locations: TaskLocation[],
  ): TaskLocationListResponse {
    const items = locations.map((location) => this.toLocationView(location));
    const completedLocationCount = items.filter(
      (location) => location.progress?.completed === true,
    ).length;
    const progressValues = items
      .map((location) => location.progress?.progress)
      .filter(
        (value): value is number => value !== null && value !== undefined,
      );
    const actualQuantityTotal = items.reduce(
      (sum, location) => sum + (location.progress?.actualQuantity ?? 0),
      0,
    );
    const plannedQuantityTotal = items.reduce(
      (sum, location) => sum + (location.plannedQuantity ?? 0),
      0,
    );

    return {
      items,
      summary: {
        locationCount: items.length,
        completedLocationCount,
        progressAverage: progressValues.length
          ? Math.round(
              progressValues.reduce((sum, value) => sum + value, 0) /
                progressValues.length,
            )
          : null,
        actualQuantityTotal,
        plannedQuantityTotal,
      },
    };
  }

  private toLocationView(location: TaskLocation): TaskLocationView {
    const progress = location.progressEntries?.[0] ?? null;
    return {
      id: location.id,
      taskId: location.taskId,
      locationCode: location.locationCode,
      locationName: location.locationName,
      description: location.description,
      plannedQuantity: location.plannedQuantity,
      unit: location.unit,
      orderIndex: location.orderIndex,
      isActive: location.isActive,
      progress: progress
        ? {
            id: progress.id,
            progress: progress.progress,
            completed: progress.completed,
            status: progress.status,
            actualQuantity: progress.actualQuantity,
            siteNote: progress.siteNote,
            updatedByUserId: progress.updatedByUserId,
            reportedAt: progress.reportedAt,
            updatedAt: progress.updatedAt,
          }
        : null,
    };
  }
}
