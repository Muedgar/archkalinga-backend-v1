import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { FilterResponse } from 'src/common/interfaces';
import { ActivityScheduleFiltersDto } from '../dtos';
import { ScheduleType, TaskActivitySchedule } from '../entities';
import { ActivityScheduleRowSerializer } from '../serializers';

@Injectable()
export class ActivityScheduleQueryService {
  constructor(
    @InjectRepository(TaskActivitySchedule)
    private readonly scheduleRepo: Repository<TaskActivitySchedule>,
  ) {}

  async listProjectSchedule(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
  ): Promise<
    FilterResponse<ActivityScheduleRowSerializer> & {
      meta: {
        projectId: string;
        includeSummaryRows: boolean;
        criticalOnly: boolean;
        orderedBy: 'wbs';
      };
    }
  > {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;
    const includeSummaryRows = filters.includeSummaryRows === true;
    const criticalOnly = filters.criticalOnly === true;

    const qb = this.scheduleRepo
      .createQueryBuilder('schedule')
      .innerJoinAndSelect('schedule.task', 'task')
      .where('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL');

    if (!includeSummaryRows) {
      qb.andWhere('task.scheduleType NOT IN (:...summaryTypes)', {
        summaryTypes: [ScheduleType.PHASE, ScheduleType.STAGE],
      });
    }

    if (criticalOnly) {
      qb.andWhere('schedule.isCritical = true');
    }

    if (filters.parentTaskId === 'root') {
      qb.andWhere('task.parentTaskId IS NULL');
    } else if (filters.parentTaskId) {
      qb.andWhere('task.parentTaskId = :parentTaskId', {
        parentTaskId: filters.parentTaskId,
      });
    }

    if (filters.branchTaskId) {
      qb.andWhere(
        '(task.id = :branchTaskId OR task.parentTaskId = :branchTaskId)',
        {
          branchTaskId: filters.branchTaskId,
        },
      );
    }

    if (filters.search) {
      qb.andWhere('(task.title ILIKE :search OR task.wbsCode ILIKE :search)', {
        search: `%${filters.search}%`,
      });
    }

    qb.orderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
      .addOrderBy('task.wbsCode', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, count] = await qb.getManyAndCount();

    return {
      items: rows.map((row) => this.serialize(row)),
      meta: { projectId, includeSummaryRows, criticalOnly, orderedBy: 'wbs' },
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async listCriticalPath(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
  ) {
    return this.listProjectSchedule(projectId, {
      ...filters,
      criticalOnly: true,
    });
  }

  private serialize(
    schedule: TaskActivitySchedule,
  ): ActivityScheduleRowSerializer {
    return plainToInstance(ActivityScheduleRowSerializer, schedule, {
      excludeExtraneousValues: true,
    });
  }
}
