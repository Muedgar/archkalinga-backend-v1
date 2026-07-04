import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import ExcelJS from 'exceljs';
import { Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { FilterResponse } from 'src/common/interfaces';
import { ActivityScheduleFiltersDto } from '../dtos';
import { ScheduleType, TaskActivitySchedule } from '../entities';
import { ActivityScheduleRowSerializer } from '../serializers';
import { TaskAuthService } from './task-auth.service';

@Injectable()
export class ActivityScheduleQueryService {
  constructor(
    @InjectRepository(TaskActivitySchedule)
    private readonly scheduleRepo: Repository<TaskActivitySchedule>,
    private readonly authSvc: TaskAuthService,
  ) {}

  async listProjectSchedule(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
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
    const qb = await this.buildProjectScheduleQuery(
      projectId,
      filters,
      requestUser,
    );

    qb.skip((page - 1) * limit).take(limit);

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

  async exportProjectScheduleWorkbook(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
    options: { sheetName?: string } = {},
  ): Promise<Buffer> {
    const rows = await (
      await this.buildProjectScheduleQuery(projectId, filters, requestUser)
    ).getMany();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Archkalinga';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(
      options.sheetName ?? 'Activity Schedule',
      {
        views: [{ state: 'frozen', ySplit: 1 }],
      },
    );

    worksheet.columns = [
      { header: 'WBS', key: 'wbsCode', width: 16 },
      { header: 'Task', key: 'title', width: 42 },
      { header: 'Schedule Type', key: 'scheduleType', width: 16 },
      { header: 'Predecessors', key: 'predecessors', width: 24 },
      { header: 'Predecessor Names', key: 'predecessorNames', width: 42 },
      { header: 'Dependency Type', key: 'dependencyTypes', width: 18 },
      { header: 'Lag (Days)', key: 'lagDays', width: 14 },
      { header: 'Duration (Days)', key: 'durationDays', width: 16 },
      { header: 'Planned Start', key: 'plannedStartDate', width: 16 },
      { header: 'Planned Finish', key: 'plannedEndDate', width: 16 },
      { header: 'Actual Start', key: 'actualStartDate', width: 16 },
      { header: 'Actual Finish', key: 'actualEndDate', width: 16 },
      { header: 'Early Start', key: 'earlyStartDate', width: 16 },
      { header: 'Early Finish', key: 'earlyFinishDate', width: 16 },
      { header: 'Late Start', key: 'lateStartDate', width: 16 },
      { header: 'Late Finish', key: 'lateFinishDate', width: 16 },
      { header: 'Total Float', key: 'totalFloatDays', width: 14 },
      { header: 'Free Float', key: 'freeFloatDays', width: 14 },
      { header: 'Critical', key: 'isCritical', width: 10 },
      { header: 'Manual', key: 'isManuallyScheduled', width: 10 },
      { header: 'Progress (%)', key: 'progress', width: 14 },
      { header: 'Completed', key: 'completed', width: 12 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle' };
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columns.length },
    };

    for (const row of rows) {
      const dependencies = row.task?.dependencyEdges ?? [];
      worksheet.addRow({
        wbsCode: row.task?.wbsCode ?? '',
        title: row.task?.title ?? '',
        scheduleType: row.task?.scheduleType ?? '',
        predecessors: dependencies
          .map(
            (dependency) =>
              dependency.dependsOnTask?.wbsCode ??
              dependency.dependsOnTaskId ??
              '',
          )
          .filter(Boolean)
          .join('; '),
        predecessorNames: dependencies
          .map((dependency) => dependency.dependsOnTask?.title ?? '')
          .filter(Boolean)
          .join('; '),
        dependencyTypes: dependencies
          .map((dependency) => dependency.dependencyType)
          .filter(Boolean)
          .join('; '),
        lagDays: dependencies
          .map((dependency) => dependency.lagDays ?? 0)
          .join('; '),
        durationDays: row.durationDays,
        plannedStartDate: row.plannedStartDate,
        plannedEndDate: row.plannedEndDate,
        actualStartDate: row.actualStartDate,
        actualEndDate: row.actualEndDate,
        earlyStartDate: row.earlyStartDate,
        earlyFinishDate: row.earlyFinishDate,
        lateStartDate: row.lateStartDate,
        lateFinishDate: row.lateFinishDate,
        totalFloatDays: row.totalFloatDays,
        freeFloatDays: row.freeFloatDays,
        isCritical: row.isCritical ? 'Yes' : 'No',
        isManuallyScheduled: row.isManuallyScheduled ? 'Yes' : 'No',
        progress: row.task?.progress ?? null,
        completed: row.task?.completed ? 'Yes' : 'No',
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async listCriticalPath(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
  ) {
    return this.listProjectSchedule(
      projectId,
      {
        ...filters,
        criticalOnly: true,
      },
      requestUser,
    );
  }

  async exportCriticalPathWorkbook(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
  ) {
    return this.exportProjectScheduleWorkbook(
      projectId,
      {
        ...filters,
        criticalOnly: true,
      },
      requestUser,
      { sheetName: 'Critical Path' },
    );
  }

  private async buildProjectScheduleQuery(
    projectId: string,
    filters: ActivityScheduleFiltersDto,
    requestUser: RequestUser,
  ) {
    const includeSummaryRows = filters.includeSummaryRows === true;
    const criticalOnly = filters.criticalOnly === true;

    const qb = this.scheduleRepo
      .createQueryBuilder('schedule')
      .innerJoinAndSelect('schedule.task', 'task')
      .leftJoinAndSelect('task.dependencyEdges', 'dependencyEdges')
      .leftJoinAndSelect('dependencyEdges.dependsOnTask', 'predecessorTask')
      .where('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL');

    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
    );
    this.authSvc.applyTaskVisibilityScope(
      qb,
      requestUser,
      canViewAllProjectTasks,
    );

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

    return qb
      .orderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
      .addOrderBy('task.wbsCode', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC');
  }

  private serialize(
    schedule: TaskActivitySchedule,
  ): ActivityScheduleRowSerializer {
    return plainToInstance(ActivityScheduleRowSerializer, schedule, {
      excludeExtraneousValues: true,
    });
  }
}
