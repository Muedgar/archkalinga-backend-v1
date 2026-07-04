import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { Project } from 'src/projects/entities';
import {
  ActivityScheduleGanttQueryDto,
  ActivityScheduleGanttScale,
} from '../dtos';
import {
  ProjectCalendar,
  ScheduleCalculationStatus,
  ScheduleType,
  Task,
  TaskActivitySchedule,
  TaskDependency,
  TaskScheduleCalculationRun,
  TaskScheduleExplanation,
} from '../entities';
import { TaskAuthService } from './task-auth.service';

type GanttBucketStatus = 'complete' | 'active' | 'overdue' | 'planned';
type ProgressStatus = 'Completed' | 'In Progress' | 'Not Started';
type CheckSeverity = 'error' | 'warning';

type ScheduleWithTask = TaskActivitySchedule & {
  task: {
    id: string;
    parentTaskId: string | null;
    title: string;
    scheduleType: ScheduleType;
    wbsCode: string | null;
    wbsSortKey: string | null;
    progress: number | null;
    completed: boolean;
    startDate: string | null;
    endDate: string | null;
  };
};

@Injectable()
export class ActivityScheduleGanttService {
  constructor(
    @InjectRepository(TaskActivitySchedule)
    private readonly scheduleRepo: Repository<TaskActivitySchedule>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskDependency)
    private readonly dependencyRepo: Repository<TaskDependency>,
    @InjectRepository(ProjectCalendar)
    private readonly calendarRepo: Repository<ProjectCalendar>,
    @InjectRepository(TaskScheduleCalculationRun)
    private readonly runRepo: Repository<TaskScheduleCalculationRun>,
    @InjectRepository(TaskScheduleExplanation)
    private readonly explanationRepo: Repository<TaskScheduleExplanation>,
    private readonly authSvc: TaskAuthService,
  ) {}

  async getGantt(
    projectId: string,
    filters: ActivityScheduleGanttQueryDto,
    requestUser: RequestUser,
  ) {
    const schedules = await this.loadScheduleRows(
      projectId,
      filters,
      requestUser,
    );
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      select: ['id', 'startDate'],
    });
    const scale = filters.scale ?? ActivityScheduleGanttScale.WEEK;
    const fromDate = this.periodStart(
      this.parseDate(
        filters.from ??
          this.firstScheduleDate(schedules) ??
          project?.startDate ??
          this.today(),
      ),
      scale,
    );
    const periods = filters.weeks ?? 36;
    const buckets = Array.from({ length: periods }, (_, index) => {
      const start = this.addPeriods(fromDate, index, scale);
      const end = this.addDays(this.addPeriods(start, 1, scale), -1);
      return {
        index,
        startDate: this.formatDate(start),
        endDate: this.formatDate(end),
        label: this.bucketLabel(start, scale),
        month: start.toLocaleString('en-US', {
          month: 'short',
          timeZone: 'UTC',
        }),
      };
    });

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;
    const count = schedules.length;
    const windowedSchedules = schedules.slice((page - 1) * limit, page * limit);

    const rows = windowedSchedules.map((schedule) => {
      const startDate = this.rowStartDate(schedule);
      const finishDate = this.rowFinishDate(schedule);
      const progress = this.progressFraction(schedule);
      return {
        taskId: schedule.taskId,
        parentTaskId: schedule.task.parentTaskId,
        wbsCode: schedule.task.wbsCode,
        wbsSortKey: schedule.task.wbsSortKey,
        level: this.ganttLevel(schedule.task.scheduleType),
        scheduleType: schedule.task.scheduleType,
        title: schedule.task.title,
        startDate,
        finishDate,
        durationDays: schedule.durationDays,
        progress: schedule.task.progress ?? 0,
        completed: this.isDone(schedule),
        isCritical: schedule.isCritical,
        totalFloatDays: schedule.totalFloatDays,
        freeFloatDays: schedule.freeFloatDays,
        buckets: buckets.map((bucket) =>
          this.bucketForWeek(
            bucket.startDate,
            bucket.endDate,
            startDate,
            finishDate,
            progress,
          ),
        ),
      };
    });

    return {
      meta: {
        projectId,
        fromDate: this.formatDate(fromDate),
        scale,
        periods,
        generatedAt: new Date().toISOString(),
      },
      summary: this.summary(schedules),
      weeks: buckets,
      rows,
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async getProgressTracker(projectId: string, requestUser: RequestUser) {
    const schedules = await this.loadScheduleRows(
      projectId,
      {
        includeSummaryRows: true,
      },
      requestUser,
    );
    const rows = schedules.map((schedule) => {
      const started = this.isStarted(schedule);
      const done = this.isDone(schedule);
      return {
        phaseId: this.phaseCode(schedule.task.wbsCode),
        stageId: this.stageCode(schedule.task.wbsCode),
        activityId: schedule.task.wbsCode,
        taskId: schedule.task.id,
        taskDescription: schedule.task.title,
        scheduleType: schedule.task.scheduleType,
        started,
        startedDate: started
          ? (schedule.actualStartDate ??
            schedule.plannedStartDate ??
            schedule.task.startDate)
          : null,
        done,
        doneDate: done
          ? (schedule.actualEndDate ??
            schedule.plannedEndDate ??
            schedule.task.endDate)
          : null,
        progress: schedule.task.progress ?? 0,
        status: this.progressStatus(started, done),
      };
    });

    return {
      meta: {
        projectId,
        generatedAt: new Date().toISOString(),
      },
      summary: this.summary(schedules),
      rows,
    };
  }

  async getSummary(projectId: string, requestUser: RequestUser) {
    const schedules = await this.loadScheduleRows(
      projectId,
      {
        includeSummaryRows: false,
      },
      requestUser,
    );
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      ...this.summary(schedules),
    };
  }

  async getChecks(projectId: string, requestUser: RequestUser) {
    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
    );
    const taskQb = this.taskRepo
      .createQueryBuilder('task')
      .where('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL')
      .select([
        'task.id',
        'task.parentTaskId',
        'task.title',
        'task.scheduleType',
        'task.wbsCode',
        'task.createdByUserId',
        'task.reporteeUserId',
      ]);
    this.authSvc.applyTaskVisibilityScope(
      taskQb,
      requestUser,
      canViewAllProjectTasks,
    );

    const [tasks, schedules, dependencies, calendar] = await Promise.all([
      taskQb.getMany(),
      this.scheduleRepo.find({ relations: ['task'] }),
      this.dependencyRepo.find(),
      this.calendarRepo.findOne({ where: { projectId } }),
    ]);

    const projectTasks = tasks;
    const taskIds = new Set(projectTasks.map((task) => task.id));
    const projectSchedules = schedules.filter((schedule) =>
      taskIds.has(schedule.taskId),
    ) as ScheduleWithTask[];
    const scheduleByTaskId = new Map(
      projectSchedules.map((schedule) => [schedule.taskId, schedule]),
    );
    const issues: Array<{
      severity: CheckSeverity;
      code: string;
      message: string;
      taskId?: string;
      wbsCode?: string | null;
    }> = [];

    const wbsSeen = new Map<string, Task>();
    for (const task of projectTasks) {
      if (task.wbsCode) {
        const duplicate = wbsSeen.get(task.wbsCode);
        if (duplicate) {
          issues.push({
            severity: 'error',
            code: 'duplicate_wbs',
            message: `Duplicate WBS code "${task.wbsCode}"`,
            taskId: task.id,
            wbsCode: task.wbsCode,
          });
        } else {
          wbsSeen.set(task.wbsCode, task);
        }
      }

      const schedule = scheduleByTaskId.get(task.id);
      if (this.isSchedulable(task.scheduleType) && !schedule) {
        issues.push({
          severity: 'error',
          code: 'missing_schedule_row',
          message: 'Schedulable task has no activity schedule row',
          taskId: task.id,
          wbsCode: task.wbsCode,
        });
      }

      if (schedule) {
        if (schedule.durationDays === null) {
          issues.push({
            severity: 'warning',
            code: 'missing_duration',
            message: 'Activity schedule duration is missing',
            taskId: task.id,
            wbsCode: task.wbsCode,
          });
        }
        if ((schedule.totalFloatDays ?? 0) < 0) {
          issues.push({
            severity: 'error',
            code: 'negative_float',
            message: 'Task has negative total float',
            taskId: task.id,
            wbsCode: task.wbsCode,
          });
        }
        if (schedule.isManuallyScheduled && !schedule.manualReason) {
          issues.push({
            severity: 'error',
            code: 'manual_without_reason',
            message: 'Manual schedule pin requires a reason',
            taskId: task.id,
            wbsCode: task.wbsCode,
          });
        }
        if (
          task.scheduleType === ScheduleType.MILESTONE &&
          (schedule.durationDays ?? 0) !== 0
        ) {
          issues.push({
            severity: 'error',
            code: 'milestone_non_zero_duration',
            message: 'Milestone should have zero duration',
            taskId: task.id,
            wbsCode: task.wbsCode,
          });
        }
        if (
          task.scheduleType === ScheduleType.ACTIVITY &&
          (schedule.durationDays ?? 0) === 0
        ) {
          issues.push({
            severity: 'warning',
            code: 'activity_zero_duration',
            message: 'Zero-duration activity should probably be a milestone',
            taskId: task.id,
            wbsCode: task.wbsCode,
          });
        }
      }
    }

    const projectDependencies = dependencies.filter(
      (dependency) =>
        taskIds.has(dependency.taskId) ||
        taskIds.has(dependency.dependsOnTaskId),
    );
    for (const dependency of projectDependencies) {
      if (
        !taskIds.has(dependency.taskId) ||
        !taskIds.has(dependency.dependsOnTaskId)
      ) {
        issues.push({
          severity: 'error',
          code: 'missing_predecessor',
          message:
            'Dependency points to a task outside this project or a deleted task',
          taskId: dependency.taskId,
        });
      }
    }

    for (const task of projectTasks.filter((task) =>
      this.isSummaryType(task.scheduleType),
    )) {
      if (!projectTasks.some((child) => child.parentTaskId === task.id)) {
        issues.push({
          severity: 'warning',
          code: 'summary_without_children',
          message: 'Summary row has no children',
          taskId: task.id,
          wbsCode: task.wbsCode,
        });
      }
    }

    if (!calendar) {
      issues.push({
        severity: 'warning',
        code: 'calendar_not_configured',
        message:
          'Project calendar is not configured; Monday-Friday defaults are used',
      });
    }

    const cycle = this.detectCycle(projectSchedules, projectDependencies);
    if (cycle) {
      issues.push({
        severity: 'error',
        code: 'dependency_cycle',
        message: 'Activity schedule dependencies contain a cycle',
      });
    }

    return {
      projectId,
      generatedAt: new Date().toISOString(),
      valid: issues.every((issue) => issue.severity !== 'error'),
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
      warningCount: issues.filter((issue) => issue.severity === 'warning')
        .length,
      issues,
    };
  }

  async getExplanation(projectId: string, taskId: string) {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
      select: ['id', 'title', 'wbsCode'],
    });
    if (!task) {
      return null;
    }

    const latestRun = await this.runRepo.findOne({
      where: { projectId, status: ScheduleCalculationStatus.SUCCESS },
      order: { finishedAt: 'DESC', createdAt: 'DESC' },
    });
    if (!latestRun) {
      return { task, calculationRun: null, explanation: null };
    }

    const explanation = await this.explanationRepo.findOne({
      where: { calculationRunId: latestRun.id, taskId },
    });

    return {
      task,
      calculationRun: {
        id: latestRun.id,
        triggerType: latestRun.triggerType,
        startedAt: latestRun.startedAt,
        finishedAt: latestRun.finishedAt,
      },
      explanation,
    };
  }

  private async loadScheduleRows(
    projectId: string,
    filters: Pick<
      ActivityScheduleGanttQueryDto,
      'includeSummaryRows' | 'criticalOnly'
    >,
    requestUser: RequestUser,
  ): Promise<ScheduleWithTask[]> {
    const qb = this.scheduleRepo
      .createQueryBuilder('schedule')
      .innerJoinAndSelect('schedule.task', 'task')
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

    if (!filters.includeSummaryRows) {
      qb.andWhere('task.scheduleType NOT IN (:...summaryTypes)', {
        summaryTypes: [ScheduleType.PHASE, ScheduleType.STAGE],
      });
    }

    if (filters.criticalOnly) {
      qb.andWhere('schedule.isCritical = true');
    }

    qb.orderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
      .addOrderBy('task.wbsCode', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC');

    return (await qb.getMany()) as ScheduleWithTask[];
  }

  private summary(schedules: ScheduleWithTask[]) {
    const activityRows = schedules.filter(
      (schedule) =>
        schedule.task.scheduleType === ScheduleType.ACTIVITY ||
        schedule.task.scheduleType === ScheduleType.MILESTONE ||
        schedule.task.scheduleType === ScheduleType.TASK,
    );
    const rowsForProgress = activityRows.length ? activityRows : schedules;
    const started = rowsForProgress.filter((schedule) =>
      this.isStarted(schedule),
    ).length;
    const complete = rowsForProgress.filter((schedule) =>
      this.isDone(schedule),
    ).length;
    const overdue = rowsForProgress.filter((schedule) =>
      this.isOverdue(schedule),
    ).length;
    const progress =
      rowsForProgress.length === 0
        ? 0
        : this.round(
            rowsForProgress.reduce(
              (sum, schedule) => sum + (schedule.task.progress ?? 0),
              0,
            ) / rowsForProgress.length,
          );

    return {
      today: this.today(),
      started,
      complete,
      overdue,
      activities: activityRows.length,
      progress,
    };
  }

  private bucketForWeek(
    weekStartDate: string,
    weekEndDate: string,
    startDate: string | null,
    finishDate: string | null,
    progress: number,
  ) {
    if (
      !startDate ||
      !finishDate ||
      weekEndDate < startDate ||
      weekStartDate > finishDate
    ) {
      return {
        weekStartDate,
        weekEndDate,
        statusCode: null,
        status: null,
      };
    }

    const start = this.parseDate(startDate);
    const finish = this.parseDate(finishDate);
    const weekStart = this.parseDate(weekStartDate);
    const weekEnd = this.parseDate(weekEndDate);
    const durationDays = Math.max(1, this.daysBetween(start, finish) + 1);
    const elapsedToWeekEnd = this.daysBetween(start, weekEnd) + 1;

    let status: GanttBucketStatus;
    if (this.daysBetween(start, finish) <= 0) {
      status = progress >= 1 ? 'complete' : 'planned';
    } else if (elapsedToWeekEnd / durationDays <= progress) {
      status = 'complete';
    } else if (this.formatDate(weekEnd) < this.today()) {
      status = 'overdue';
    } else if (this.formatDate(weekStart) <= this.today()) {
      status = 'active';
    } else {
      status = 'planned';
    }

    return {
      weekStartDate,
      weekEndDate,
      statusCode: this.statusCode(status),
      status,
    };
  }

  private firstScheduleDate(schedules: ScheduleWithTask[]): string | null {
    const dates = schedules
      .map((schedule) => this.rowStartDate(schedule))
      .filter((date): date is string => Boolean(date))
      .sort();
    return dates[0] ?? null;
  }

  private rowStartDate(schedule: ScheduleWithTask): string | null {
    return (
      schedule.plannedStartDate ??
      schedule.earlyStartDate ??
      schedule.task.startDate ??
      null
    );
  }

  private rowFinishDate(schedule: ScheduleWithTask): string | null {
    return (
      schedule.plannedEndDate ??
      schedule.earlyFinishDate ??
      schedule.task.endDate ??
      null
    );
  }

  private progressFraction(schedule: ScheduleWithTask): number {
    return Math.max(0, Math.min(1, (schedule.task.progress ?? 0) / 100));
  }

  private isStarted(schedule: ScheduleWithTask): boolean {
    return Boolean(
      schedule.actualStartDate ||
      schedule.task.startDate ||
      (schedule.task.progress ?? 0) > 0 ||
      schedule.task.completed,
    );
  }

  private isDone(schedule: ScheduleWithTask): boolean {
    return Boolean(
      schedule.actualEndDate ||
      schedule.task.completed ||
      (schedule.task.progress ?? 0) >= 100,
    );
  }

  private isOverdue(schedule: ScheduleWithTask): boolean {
    const finishDate = this.rowFinishDate(schedule);
    return Boolean(
      finishDate && finishDate < this.today() && !this.isDone(schedule),
    );
  }

  private progressStatus(started: boolean, done: boolean): ProgressStatus {
    if (done) return 'Completed';
    if (started) return 'In Progress';
    return 'Not Started';
  }

  private statusCode(status: GanttBucketStatus): 'C' | 'A' | 'O' | 'P' {
    switch (status) {
      case 'complete':
        return 'C';
      case 'active':
        return 'A';
      case 'overdue':
        return 'O';
      case 'planned':
      default:
        return 'P';
    }
  }

  private ganttLevel(scheduleType: ScheduleType): number {
    if (scheduleType === ScheduleType.PHASE) return 1;
    if (scheduleType === ScheduleType.STAGE) return 2;
    return 3;
  }

  private phaseCode(wbsCode: string | null): string | null {
    return wbsCode?.split('.')[0] ?? null;
  }

  private stageCode(wbsCode: string | null): string | null {
    const parts = wbsCode?.split('.') ?? [];
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : null;
  }

  private isSchedulable(scheduleType: ScheduleType): boolean {
    return (
      scheduleType === ScheduleType.PHASE ||
      scheduleType === ScheduleType.STAGE ||
      scheduleType === ScheduleType.ACTIVITY ||
      scheduleType === ScheduleType.TASK ||
      scheduleType === ScheduleType.MILESTONE
    );
  }

  private isSummaryType(scheduleType: ScheduleType): boolean {
    return (
      scheduleType === ScheduleType.PHASE || scheduleType === ScheduleType.STAGE
    );
  }

  private detectCycle(
    schedules: ScheduleWithTask[],
    dependencies: TaskDependency[],
  ): boolean {
    const taskIds = new Set(schedules.map((schedule) => schedule.taskId));
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const taskId of taskIds) {
      indegree.set(taskId, 0);
      outgoing.set(taskId, []);
    }

    for (const dependency of dependencies) {
      if (
        !taskIds.has(dependency.taskId) ||
        !taskIds.has(dependency.dependsOnTaskId)
      ) {
        continue;
      }
      outgoing.get(dependency.dependsOnTaskId)!.push(dependency.taskId);
      indegree.set(
        dependency.taskId,
        (indegree.get(dependency.taskId) ?? 0) + 1,
      );
    }

    const queue = [...indegree.entries()]
      .filter(([, count]) => count === 0)
      .map(([taskId]) => taskId);
    let visited = 0;
    while (queue.length) {
      const taskId = queue.shift()!;
      visited += 1;
      for (const successorId of outgoing.get(taskId) ?? []) {
        const next = (indegree.get(successorId) ?? 0) - 1;
        indegree.set(successorId, next);
        if (next === 0) queue.push(successorId);
      }
    }
    return visited !== taskIds.size;
  }

  private periodStart(date: Date, scale: ActivityScheduleGanttScale): Date {
    if (scale === ActivityScheduleGanttScale.DAY) return date;
    if (scale === ActivityScheduleGanttScale.MONTH) {
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    }
    if (scale === ActivityScheduleGanttScale.QUARTER) {
      const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
      return new Date(Date.UTC(date.getUTCFullYear(), quarterMonth, 1));
    }
    return this.startOfIsoWeek(date);
  }

  private addPeriods(
    date: Date,
    count: number,
    scale: ActivityScheduleGanttScale,
  ): Date {
    if (scale === ActivityScheduleGanttScale.DAY) {
      return this.addDays(date, count);
    }
    if (scale === ActivityScheduleGanttScale.MONTH) {
      return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1),
      );
    }
    if (scale === ActivityScheduleGanttScale.QUARTER) {
      return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count * 3, 1),
      );
    }
    return this.addDays(date, count * 7);
  }

  private bucketLabel(date: Date, scale: ActivityScheduleGanttScale): string {
    if (scale === ActivityScheduleGanttScale.MONTH) {
      return date.toLocaleString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
    if (scale === ActivityScheduleGanttScale.QUARTER) {
      return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
    }
    return this.formatDate(date);
  }

  private startOfIsoWeek(date: Date): Date {
    const day = date.getUTCDay();
    const delta = day === 0 ? -6 : 1 - day;
    return this.addDays(date, delta);
  }

  private parseDate(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private daysBetween(start: Date, end: Date): number {
    return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  }

  private today(): string {
    return this.formatDate(new Date());
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
