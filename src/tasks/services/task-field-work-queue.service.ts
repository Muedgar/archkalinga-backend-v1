import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { ProjectMembership } from 'src/projects/entities';
import {
  Task,
  TaskChecklistBranchStatus,
  TaskChecklistItem,
  TaskLocation,
} from '../entities';
import { FieldWorkQueueQueryDto } from '../dtos';
import { TaskAuthService } from './task-auth.service';

type FieldChecklistItem = {
  id: string;
  text: string;
  orderIndex: number;
  itemCode: string | null;
  checklistGroupId: string | null;
  completed: boolean;
  completedAt: Date | null;
};

type FieldLocation = {
  id: string;
  locationCode: string | null;
  locationName: string;
  plannedQuantity: number | null;
  unit: string | null;
  progress: {
    id: string;
    progress: number | null;
    completed: boolean;
    status: string | null;
    actualQuantity: number | null;
    siteNote: string | null;
    reportedAt: Date | null;
    updatedAt: Date;
  } | null;
};

type FieldWorkQueueItem = {
  task: {
    id: string;
    projectId: string;
    parentTaskId: string | null;
    title: string;
    statusId: string;
    status: {
      id: string;
      name: string;
      key: string;
      category: string;
      isTerminal: boolean;
    } | null;
    priority: {
      id: string;
      name: string;
      key: string;
      color: string;
    } | null;
    startDate: string | null;
    endDate: string | null;
    progress: number | null;
    wbsCode: string | null;
    updatedAt: Date;
  };
  checklistItems: FieldChecklistItem[];
  locations: FieldLocation[];
  progressControls: {
    canUpdateTaskProgress: boolean;
    canUpdateChecklist: boolean;
    canUpdateLocations: boolean;
  };
  sync: {
    entity: 'task-work-item';
    taskId: string;
    lastChangedAt: Date;
    checklistItemIds: string[];
    locationIds: string[];
  };
};

export type FieldWorkQueueResponse = {
  projectId: string;
  userId: string;
  date: string;
  items: FieldWorkQueueItem[];
  summary: {
    taskCount: number;
    checklistItemCount: number;
    locationCount: number;
    completedLocationCount: number;
  };
  sync: {
    generatedAt: string;
    cursor: string | null;
  };
};

@Injectable()
export class TaskFieldWorkQueueService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskChecklistItem)
    private readonly checklistRepo: Repository<TaskChecklistItem>,
    @InjectRepository(TaskLocation)
    private readonly locationRepo: Repository<TaskLocation>,
    private readonly authSvc: TaskAuthService,
  ) {}

  async getToday(
    projectId: string,
    query: FieldWorkQueueQueryDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<FieldWorkQueueResponse> {
    if (prefetchedMembership === undefined) {
      await this.authSvc.verifyProjectPermission(
        projectId,
        requestUser,
        'view',
      );
    }

    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const includeCompleted = query.includeCompleted ?? false;
    const limit = query.limit ?? 100;
    const tasks = await this.loadAssignedLeafTasks(
      projectId,
      requestUser.id,
      date,
      includeCompleted,
      limit,
    );
    const taskIds = tasks.map((task) => task.id);

    const [checklistItems, locations] = await Promise.all([
      this.loadFlatChecklistItems(taskIds, includeCompleted),
      this.loadLocations(taskIds, includeCompleted),
    ]);

    const checklistMap = new Map<string, TaskChecklistItem[]>();
    for (const item of checklistItems) {
      const bucket = checklistMap.get(item.taskId) ?? [];
      bucket.push(item);
      checklistMap.set(item.taskId, bucket);
    }

    const locationMap = new Map<string, TaskLocation[]>();
    for (const location of locations) {
      const bucket = locationMap.get(location.taskId) ?? [];
      bucket.push(location);
      locationMap.set(location.taskId, bucket);
    }

    const items = tasks.map((task) =>
      this.toQueueItem(
        task,
        checklistMap.get(task.id) ?? [],
        locationMap.get(task.id) ?? [],
      ),
    );
    const locationCount = items.reduce(
      (sum, item) => sum + item.locations.length,
      0,
    );
    const completedLocationCount = items.reduce(
      (sum, item) =>
        sum +
        item.locations.filter((location) => location.progress?.completed)
          .length,
      0,
    );

    return {
      projectId,
      userId: requestUser.id,
      date,
      items,
      summary: {
        taskCount: items.length,
        checklistItemCount: items.reduce(
          (sum, item) => sum + item.checklistItems.length,
          0,
        ),
        locationCount,
        completedLocationCount,
      },
      sync: {
        generatedAt: new Date().toISOString(),
        cursor: this.buildCursor(items),
      },
    };
  }

  private async loadAssignedLeafTasks(
    projectId: string,
    userId: string,
    date: string,
    includeCompleted: boolean,
    limit: number,
  ): Promise<Task[]> {
    const qb = this.taskRepo
      .createQueryBuilder('task')
      .innerJoin(
        'task.assignees',
        'assignedUser',
        'assignedUser.userId = :userId',
        {
          userId,
        },
      )
      .leftJoinAndSelect('task.status', 'status')
      .leftJoinAndSelect('task.priority', 'priority')
      .leftJoinAndSelect('task.activitySchedule', 'activitySchedule')
      .where('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL')
      .andWhere('task.supersededByTaskId IS NULL')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM "tasks" "child"
          WHERE "child"."parentTaskId" = task.id
            AND "child"."deletedAt" IS NULL
            AND "child"."superseded_by_task_id" IS NULL
        )`,
      )
      .andWhere(
        `(
          (task.startDate IS NULL AND task.endDate IS NULL)
          OR (task.startDate IS NULL AND task.endDate <= :date)
          OR (task.startDate <= :date AND task.endDate IS NULL)
          OR (task.startDate <= :date AND task.endDate >= :date)
          OR (
            "activitySchedule"."planned_start_date" IS NOT NULL
            AND "activitySchedule"."planned_end_date" IS NOT NULL
            AND "activitySchedule"."planned_start_date" <= :date
            AND "activitySchedule"."planned_end_date" >= :date
          )
        )`,
        { date },
      );

    if (!includeCompleted) qb.andWhere('task.completed = false');

    return qb
      .orderBy('task.endDate', 'ASC', 'NULLS LAST')
      .addOrderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
      .addOrderBy('task.rank', 'ASC', 'NULLS LAST')
      .take(limit)
      .getMany();
  }

  private async loadFlatChecklistItems(
    taskIds: string[],
    includeCompleted: boolean,
  ): Promise<TaskChecklistItem[]> {
    if (!taskIds.length) return [];
    const qb = this.checklistRepo
      .createQueryBuilder('item')
      .where('item.taskId IN (:...taskIds)', { taskIds })
      .andWhere('item.branchedTaskId IS NULL')
      .andWhere('item.branchStatus = :branchStatus', {
        branchStatus: TaskChecklistBranchStatus.FLAT,
      });
    if (!includeCompleted) qb.andWhere('item.completed = false');
    return qb.orderBy('item.orderIndex', 'ASC').getMany();
  }

  private async loadLocations(
    taskIds: string[],
    includeCompleted: boolean,
  ): Promise<TaskLocation[]> {
    if (!taskIds.length) return [];

    const qb = this.locationRepo
      .createQueryBuilder('location')
      .leftJoinAndSelect('location.progressEntries', 'progress')
      .where('location.taskId IN (:...taskIds)', { taskIds })
      .andWhere('location.isActive = true');

    if (!includeCompleted) {
      qb.andWhere('(progress.id IS NULL OR progress.completed = false)');
    }

    return qb
      .orderBy('location.orderIndex', 'ASC')
      .addOrderBy('location.createdAt', 'ASC')
      .getMany();
  }

  private toQueueItem(
    task: Task,
    checklistItems: TaskChecklistItem[],
    locations: TaskLocation[],
  ): FieldWorkQueueItem {
    const checklistViews = checklistItems.map((item) => ({
      id: item.id,
      text: item.text,
      orderIndex: item.orderIndex,
      itemCode: item.itemCode,
      checklistGroupId: item.checklistGroupId,
      completed: item.completed,
      completedAt: item.completedAt,
    }));
    const locationViews = locations.map((location) =>
      this.toLocationView(location),
    );
    const lastChangedAt = [
      task.updatedAt,
      ...checklistItems.map((item) => item.updatedAt),
      ...locations.map((location) => location.updatedAt),
      ...locations.flatMap((location) =>
        (location.progressEntries ?? []).map((progress) => progress.updatedAt),
      ),
    ].sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      task: {
        id: task.id,
        projectId: task.projectId,
        parentTaskId: task.parentTaskId,
        title: task.title,
        statusId: task.statusId,
        status: task.status
          ? {
              id: task.status.id,
              name: task.status.name,
              key: task.status.key,
              category: task.status.category,
              isTerminal: task.status.isTerminal,
            }
          : null,
        priority: task.priority
          ? {
              id: task.priority.id,
              name: task.priority.name,
              key: task.priority.key,
              color: task.priority.color,
            }
          : null,
        startDate: task.startDate,
        endDate: task.endDate,
        progress: task.progress,
        wbsCode: task.wbsCode,
        updatedAt: task.updatedAt,
      },
      checklistItems: checklistViews,
      locations: locationViews,
      progressControls: {
        canUpdateTaskProgress: true,
        canUpdateChecklist: true,
        canUpdateLocations: true,
      },
      sync: {
        entity: 'task-work-item',
        taskId: task.id,
        lastChangedAt,
        checklistItemIds: checklistViews.map((item) => item.id),
        locationIds: locationViews.map((location) => location.id),
      },
    };
  }

  private toLocationView(location: TaskLocation): FieldLocation {
    const progress = location.progressEntries?.[0] ?? null;
    return {
      id: location.id,
      locationCode: location.locationCode,
      locationName: location.locationName,
      plannedQuantity: location.plannedQuantity,
      unit: location.unit,
      progress: progress
        ? {
            id: progress.id,
            progress: progress.progress,
            completed: progress.completed,
            status: progress.status,
            actualQuantity: progress.actualQuantity,
            siteNote: progress.siteNote,
            reportedAt: progress.reportedAt,
            updatedAt: progress.updatedAt,
          }
        : null,
    };
  }

  private buildCursor(items: FieldWorkQueueItem[]): string | null {
    const latest = items
      .map((item) => item.sync.lastChangedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return latest ? latest.toISOString() : null;
  }
}
