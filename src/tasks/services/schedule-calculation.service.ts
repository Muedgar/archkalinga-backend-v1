import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Project } from 'src/projects/entities';
import {
  DependencyType,
  ProjectCalendar,
  ProjectCalendarException,
  ScheduleCalculationStatus,
  ScheduleType,
  Task,
  TaskActivitySchedule,
  TaskDependency,
  TaskScheduleCalculationRun,
  TaskScheduleExplanation,
} from '../entities';
import { RecalculateActivityScheduleDto } from '../dtos';

type CpmEdge = {
  predecessorId: string;
  successorId: string;
  dependencyType: DependencyType;
  lagDays: number;
};

type CpmNode = {
  taskId: string;
  schedule: TaskActivitySchedule;
  duration: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
  isSummaryRollup: boolean;
  drivingPredecessorIds: Set<string>;
  successorPressureIds: Set<string>;
};

type ScheduledTask = Pick<Task, 'id' | 'parentTaskId' | 'scheduleType'>;

type CalendarContext = {
  projectStartDate: string | null;
  workingWeekdays: Set<number>;
  exceptions: Map<string, boolean>;
};

@Injectable()
export class ScheduleCalculationService {
  private static readonly EPSILON = 0.00001;

  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(ProjectCalendar)
    private readonly calendarRepo: Repository<ProjectCalendar>,
    @InjectRepository(ProjectCalendarException)
    private readonly calendarExceptionRepo: Repository<ProjectCalendarException>,
    @InjectRepository(TaskDependency)
    private readonly dependencyRepo: Repository<TaskDependency>,
    @InjectRepository(TaskActivitySchedule)
    private readonly scheduleRepo: Repository<TaskActivitySchedule>,
    @InjectRepository(TaskScheduleCalculationRun)
    private readonly runRepo: Repository<TaskScheduleCalculationRun>,
    @InjectRepository(TaskScheduleExplanation)
    private readonly explanationRepo: Repository<TaskScheduleExplanation>,
  ) {}

  async recalculateProject(
    projectId: string,
    dto: RecalculateActivityScheduleDto = {},
  ): Promise<{
    calculationRunId: string;
    projectId: string;
    taskCount: number;
    dependencyCount: number;
    summaryRollupTaskCount: number;
    projectDurationDays: number;
    criticalTaskIds: string[];
  }> {
    const run = await this.runRepo.save(
      this.runRepo.create({
        projectId,
        triggerTaskId: dto.triggerTaskId ?? null,
        triggerType: dto.triggerType?.trim() || 'manual',
        status: ScheduleCalculationStatus.RUNNING,
        startedAt: new Date(),
        summaryJson: {},
      }),
    );

    try {
      const result = await this.calculateAndPersist(projectId, run.id);
      run.status = ScheduleCalculationStatus.SUCCESS;
      run.finishedAt = new Date();
      run.summaryJson = result;
      await this.runRepo.save(run);
      return { calculationRunId: run.id, projectId, ...result };
    } catch (error) {
      run.status = ScheduleCalculationStatus.FAILED;
      run.finishedAt = new Date();
      run.errorMessage =
        error instanceof Error ? error.message : 'Schedule calculation failed';
      await this.runRepo.save(run);
      throw error;
    }
  }

  private async calculateAndPersist(
    projectId: string,
    calculationRunId: string,
  ): Promise<{
    taskCount: number;
    dependencyCount: number;
    summaryRollupTaskCount: number;
    projectDurationDays: number;
    criticalTaskIds: string[];
  }> {
    const tasks = await this.taskRepo.find({
      where: { projectId, deletedAt: IsNull() },
      select: ['id', 'parentTaskId', 'scheduleType'],
    });
    const taskIds = tasks.map((task) => task.id);
    if (!taskIds.length) {
      return {
        taskCount: 0,
        dependencyCount: 0,
        summaryRollupTaskCount: 0,
        projectDurationDays: 0,
        criticalTaskIds: [],
      };
    }

    const calendar = await this.loadCalendarContext(projectId);
    const schedules = await this.scheduleRepo.find({
      where: { taskId: In(taskIds) },
    });
    const nodes = this.buildNodes(schedules, calendar);
    if (!nodes.size) {
      return {
        taskCount: 0,
        dependencyCount: 0,
        summaryRollupTaskCount: 0,
        projectDurationDays: 0,
        criticalTaskIds: [],
      };
    }

    const edges = await this.loadEdges([...nodes.keys()]);
    const { topologicalOrder, incoming, outgoing } = this.sortGraph(
      nodes,
      edges,
    );

    this.forwardPass(topologicalOrder, nodes, incoming);
    const projectDurationDays = this.max(
      [...nodes.values()].map((node) => node.ef),
    );
    this.backwardPass(
      [...topologicalOrder].reverse(),
      nodes,
      outgoing,
      projectDurationDays,
    );
    this.computeFloats(nodes, outgoing);
    const summaryRollupTaskCount = this.rollupSummaryRows(tasks, nodes);

    const now = new Date();
    const schedulesToSave = [...nodes.values()].map((node) => {
      const duration = this.round(node.duration);
      const earlyStart = this.round(node.es);
      const earlyFinish = this.round(node.ef);
      const lateStart = this.round(node.ls);
      const lateFinish = this.round(node.lf);
      node.schedule.durationDays = duration;
      node.schedule.earlyStartOffset = earlyStart;
      node.schedule.earlyFinishOffset = earlyFinish;
      node.schedule.lateStartOffset = lateStart;
      node.schedule.lateFinishOffset = lateFinish;
      node.schedule.plannedStartOffset = earlyStart;
      node.schedule.plannedEndOffset = earlyFinish;
      node.schedule.earlyStartDate = this.offsetToWorkingDate(
        earlyStart,
        calendar,
      );
      node.schedule.earlyFinishDate = this.offsetToWorkingDate(
        earlyFinish,
        calendar,
      );
      node.schedule.lateStartDate = this.offsetToWorkingDate(
        lateStart,
        calendar,
      );
      node.schedule.lateFinishDate = this.offsetToWorkingDate(
        lateFinish,
        calendar,
      );
      if (node.schedule.isManuallyScheduled) {
        node.schedule.plannedStartDate =
          node.schedule.plannedStartDate ?? node.schedule.earlyStartDate;
        node.schedule.plannedEndDate =
          node.schedule.plannedEndDate ?? node.schedule.earlyFinishDate;
      } else {
        node.schedule.plannedStartDate = node.schedule.earlyStartDate;
        node.schedule.plannedEndDate = node.schedule.earlyFinishDate;
      }
      node.schedule.totalFloatDays = this.round(node.totalFloat);
      node.schedule.freeFloatDays = this.round(node.freeFloat);
      node.schedule.isCritical = node.isCritical;
      node.schedule.calculatedAt = now;
      return node.schedule;
    });

    const explanations = [...nodes.values()].map((node) =>
      this.explanationRepo.create({
        calculationRunId,
        taskId: node.taskId,
        isCritical: node.isCritical,
        drivingPredecessorIds: [...node.drivingPredecessorIds],
        successorPressureIds: [...node.successorPressureIds],
        explanationJson: {
          earlyStart: this.round(node.es),
          earlyFinish: this.round(node.ef),
          lateStart: this.round(node.ls),
          lateFinish: this.round(node.lf),
          totalFloat: this.round(node.totalFloat),
          freeFloat: this.round(node.freeFloat),
          duration: this.round(node.duration),
          rollupSummary: node.isSummaryRollup,
        },
      }),
    );

    await this.scheduleRepo.manager.transaction(async (tx) => {
      await tx.save(TaskActivitySchedule, schedulesToSave);
      await tx.delete(TaskScheduleExplanation, { calculationRunId });
      await tx.save(TaskScheduleExplanation, explanations);
    });

    const criticalTaskIds = [...nodes.values()]
      .filter((node) => node.isCritical)
      .map((node) => node.taskId);

    return {
      taskCount: nodes.size,
      dependencyCount: edges.length,
      summaryRollupTaskCount,
      projectDurationDays: this.round(projectDurationDays),
      criticalTaskIds,
    };
  }

  private buildNodes(
    schedules: TaskActivitySchedule[],
    calendar: CalendarContext,
  ): Map<string, CpmNode> {
    return new Map(
      schedules.map((schedule) => {
        const duration = Math.max(0, schedule.durationDays ?? 0);
        const pinnedStart = schedule.isManuallyScheduled
          ? (schedule.plannedStartOffset ??
            this.workingDateToOffset(schedule.plannedStartDate, calendar) ??
            this.finishDateToStartOffset(
              schedule.plannedEndDate,
              calendar,
              duration,
            ) ??
            0)
          : 0;
        const node: CpmNode = {
          taskId: schedule.taskId,
          schedule,
          duration,
          es: pinnedStart,
          ef: pinnedStart + duration,
          ls: 0,
          lf: 0,
          totalFloat: 0,
          freeFloat: 0,
          isCritical: false,
          isSummaryRollup: false,
          drivingPredecessorIds: new Set<string>(),
          successorPressureIds: new Set<string>(),
        };
        return [schedule.taskId, node];
      }),
    );
  }

  private async loadEdges(taskIds: string[]): Promise<CpmEdge[]> {
    const dependencies = await this.dependencyRepo.find({
      where: { taskId: In(taskIds), dependsOnTaskId: In(taskIds) },
      select: ['taskId', 'dependsOnTaskId', 'dependencyType', 'lagDays'],
    });
    return dependencies.map((dependency) => ({
      predecessorId: dependency.dependsOnTaskId,
      successorId: dependency.taskId,
      dependencyType: dependency.dependencyType,
      lagDays: dependency.lagDays ?? 0,
    }));
  }

  private sortGraph(
    nodes: Map<string, CpmNode>,
    edges: CpmEdge[],
  ): {
    topologicalOrder: string[];
    incoming: Map<string, CpmEdge[]>;
    outgoing: Map<string, CpmEdge[]>;
  } {
    const incoming = new Map<string, CpmEdge[]>();
    const outgoing = new Map<string, CpmEdge[]>();
    const indegree = new Map<string, number>();

    for (const id of nodes.keys()) {
      incoming.set(id, []);
      outgoing.set(id, []);
      indegree.set(id, 0);
    }

    for (const edge of edges) {
      incoming.get(edge.successorId)!.push(edge);
      outgoing.get(edge.predecessorId)!.push(edge);
      indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1);
    }

    const queue = [...indegree.entries()]
      .filter(([, count]) => count === 0)
      .map(([id]) => id);
    const topologicalOrder: string[] = [];

    while (queue.length > 0) {
      const id = queue.shift()!;
      topologicalOrder.push(id);
      for (const edge of outgoing.get(id) ?? []) {
        const nextCount = (indegree.get(edge.successorId) ?? 0) - 1;
        indegree.set(edge.successorId, nextCount);
        if (nextCount === 0) queue.push(edge.successorId);
      }
    }

    if (topologicalOrder.length !== nodes.size) {
      throw new BadRequestException(
        'Activity schedule dependencies contain a cycle and cannot be recalculated',
      );
    }

    return { topologicalOrder, incoming, outgoing };
  }

  private forwardPass(
    topologicalOrder: string[],
    nodes: Map<string, CpmNode>,
    incoming: Map<string, CpmEdge[]>,
  ): void {
    for (const taskId of topologicalOrder) {
      const node = nodes.get(taskId)!;
      let bestEs = node.es;
      const drivers = new Set<string>();

      for (const edge of incoming.get(taskId) ?? []) {
        const predecessor = nodes.get(edge.predecessorId)!;
        const candidateEs = this.forwardCandidateEs(node, predecessor, edge);
        if (candidateEs > bestEs + ScheduleCalculationService.EPSILON) {
          bestEs = candidateEs;
          drivers.clear();
          drivers.add(edge.predecessorId);
        } else if (
          Math.abs(candidateEs - bestEs) <= ScheduleCalculationService.EPSILON
        ) {
          drivers.add(edge.predecessorId);
        }
      }

      node.es = bestEs;
      node.ef = bestEs + node.duration;
      node.drivingPredecessorIds = drivers;
    }
  }

  private forwardCandidateEs(
    successor: CpmNode,
    predecessor: CpmNode,
    edge: CpmEdge,
  ): number {
    switch (edge.dependencyType) {
      case DependencyType.START_TO_START:
        return predecessor.es + edge.lagDays;
      case DependencyType.FINISH_TO_FINISH:
        return predecessor.ef + edge.lagDays - successor.duration;
      case DependencyType.START_TO_FINISH:
        return predecessor.es + edge.lagDays - successor.duration;
      case DependencyType.FINISH_TO_START:
      default:
        return predecessor.ef + edge.lagDays;
    }
  }

  private backwardPass(
    reverseTopologicalOrder: string[],
    nodes: Map<string, CpmNode>,
    outgoing: Map<string, CpmEdge[]>,
    projectDuration: number,
  ): void {
    for (const node of nodes.values()) {
      node.lf = projectDuration;
      node.ls = projectDuration - node.duration;
    }

    for (const taskId of reverseTopologicalOrder) {
      const node = nodes.get(taskId)!;
      const successors = outgoing.get(taskId) ?? [];
      if (!successors.length) continue;

      let bestLf = Number.POSITIVE_INFINITY;
      const pressures = new Set<string>();

      for (const edge of successors) {
        const successor = nodes.get(edge.successorId)!;
        const candidateLf = this.backwardCandidateLf(node, successor, edge);
        if (candidateLf < bestLf - ScheduleCalculationService.EPSILON) {
          bestLf = candidateLf;
          pressures.clear();
          pressures.add(edge.successorId);
        } else if (
          Math.abs(candidateLf - bestLf) <= ScheduleCalculationService.EPSILON
        ) {
          pressures.add(edge.successorId);
        }
      }

      node.lf = bestLf;
      node.ls = bestLf - node.duration;
      node.successorPressureIds = pressures;
    }
  }

  private backwardCandidateLf(
    predecessor: CpmNode,
    successor: CpmNode,
    edge: CpmEdge,
  ): number {
    switch (edge.dependencyType) {
      case DependencyType.START_TO_START:
        return successor.ls - edge.lagDays + predecessor.duration;
      case DependencyType.FINISH_TO_FINISH:
        return successor.lf - edge.lagDays;
      case DependencyType.START_TO_FINISH:
        return successor.lf - edge.lagDays + predecessor.duration;
      case DependencyType.FINISH_TO_START:
      default:
        return successor.ls - edge.lagDays;
    }
  }

  private computeFloats(
    nodes: Map<string, CpmNode>,
    outgoing: Map<string, CpmEdge[]>,
  ): void {
    for (const node of nodes.values()) {
      node.totalFloat = node.ls - node.es;
      node.freeFloat = this.freeFloat(
        node,
        nodes,
        outgoing.get(node.taskId) ?? [],
      );
      node.isCritical =
        Math.abs(node.totalFloat) <= ScheduleCalculationService.EPSILON;
    }
  }

  private rollupSummaryRows(
    tasks: ScheduledTask[],
    nodes: Map<string, CpmNode>,
  ): number {
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const childrenByParent = new Map<string, string[]>();

    for (const task of tasks) {
      if (!task.parentTaskId) continue;
      if (!nodes.has(task.id) || !nodes.has(task.parentTaskId)) continue;
      const siblings = childrenByParent.get(task.parentTaskId) ?? [];
      siblings.push(task.id);
      childrenByParent.set(task.parentTaskId, siblings);
    }

    const depthCache = new Map<string, number>();
    const summaryTaskIds = [...childrenByParent.keys()]
      .filter((taskId) => this.isSummaryTask(taskById.get(taskId)))
      .sort(
        (a, b) =>
          this.depth(b, taskById, depthCache) -
          this.depth(a, taskById, depthCache),
      );

    let rolledUp = 0;
    for (const taskId of summaryTaskIds) {
      const node = nodes.get(taskId);
      if (!node) continue;

      const childNodes = (childrenByParent.get(taskId) ?? [])
        .map((childId) => nodes.get(childId))
        .filter((child): child is CpmNode => Boolean(child));
      if (!childNodes.length) continue;

      const minChildEs = Math.min(...childNodes.map((child) => child.es));
      const maxChildEf = Math.max(...childNodes.map((child) => child.ef));
      const minChildLs = Math.min(...childNodes.map((child) => child.ls));
      const maxChildLf = Math.max(...childNodes.map((child) => child.lf));

      node.es = minChildEs;
      node.ef = maxChildEf;
      node.ls = minChildLs;
      node.lf = maxChildLf;
      node.duration = maxChildLf - minChildEs;
      node.totalFloat = minChildLs - minChildEs;
      node.freeFloat = Math.min(...childNodes.map((child) => child.freeFloat));
      node.isCritical = childNodes.some((child) => child.isCritical);
      node.isSummaryRollup = true;
      node.drivingPredecessorIds = this.unionSets(
        childNodes.map((child) => child.drivingPredecessorIds),
      );
      node.successorPressureIds = this.unionSets(
        childNodes.map((child) => child.successorPressureIds),
      );
      rolledUp += 1;
    }

    return rolledUp;
  }

  private isSummaryTask(task: ScheduledTask | undefined): boolean {
    if (!task) return false;
    return (
      task.scheduleType === ScheduleType.PHASE ||
      task.scheduleType === ScheduleType.STAGE ||
      task.scheduleType === ScheduleType.ACTIVITY ||
      task.scheduleType === ScheduleType.TASK
    );
  }

  private depth(
    taskId: string,
    taskById: Map<string, ScheduledTask>,
    cache: Map<string, number>,
  ): number {
    const cached = cache.get(taskId);
    if (cached !== undefined) return cached;

    const parentTaskId = taskById.get(taskId)?.parentTaskId;
    const depth = parentTaskId
      ? this.depth(parentTaskId, taskById, cache) + 1
      : 0;
    cache.set(taskId, depth);
    return depth;
  }

  private unionSets(sets: Array<Set<string>>): Set<string> {
    const union = new Set<string>();
    for (const set of sets) {
      for (const value of set) union.add(value);
    }
    return union;
  }

  private freeFloat(
    node: CpmNode,
    nodes: Map<string, CpmNode>,
    outgoing: CpmEdge[],
  ): number {
    if (!outgoing.length) return node.totalFloat;

    const candidates = outgoing.map((edge) => {
      const successor = nodes.get(edge.successorId)!;
      switch (edge.dependencyType) {
        case DependencyType.START_TO_START:
          return successor.es - edge.lagDays - node.es;
        case DependencyType.FINISH_TO_FINISH:
          return successor.ef - edge.lagDays - node.ef;
        case DependencyType.START_TO_FINISH:
          return successor.ef - edge.lagDays - node.es;
        case DependencyType.FINISH_TO_START:
        default:
          return successor.es - edge.lagDays - node.ef;
      }
    });

    return this.max([0, Math.min(...candidates)]);
  }

  private async loadCalendarContext(
    projectId: string,
  ): Promise<CalendarContext> {
    const [project, calendar] = await Promise.all([
      this.projectRepo.findOne({
        where: { id: projectId },
        select: ['id', 'startDate'],
      }),
      this.calendarRepo.findOne({ where: { projectId } }),
    ]);

    const workingWeekdays = new Set(
      calendar?.workingWeekdays?.length
        ? calendar.workingWeekdays
        : [1, 2, 3, 4, 5],
    );
    const exceptions = new Map<string, boolean>();

    if (calendar) {
      const calendarExceptions = await this.calendarExceptionRepo.find({
        where: { calendarId: calendar.id },
        select: ['date', 'isWorkingDay'],
      });
      for (const exception of calendarExceptions) {
        exceptions.set(exception.date, exception.isWorkingDay);
      }
    }

    return {
      projectStartDate: project?.startDate ?? null,
      workingWeekdays,
      exceptions,
    };
  }

  private offsetToWorkingDate(
    offset: number | null,
    calendar: CalendarContext,
  ): string | null {
    if (offset === null || !calendar.projectStartDate) {
      return null;
    }

    const wholeDays = Math.floor(Math.abs(offset));
    const direction = offset < 0 ? -1 : 1;
    let date = this.firstWorkingDateOnOrAfter(
      this.parseDate(calendar.projectStartDate),
      calendar,
    );

    for (let remaining = wholeDays; remaining > 0; remaining -= 1) {
      date = this.nextWorkingDate(date, calendar, direction);
    }

    return this.formatDate(date);
  }

  private workingDateToOffset(
    date: string | null,
    calendar: CalendarContext,
  ): number | null {
    if (!date || !calendar.projectStartDate) {
      return null;
    }

    const target = this.formatDate(
      this.firstWorkingDateOnOrAfter(this.parseDate(date), calendar),
    );
    const start = this.formatDate(
      this.firstWorkingDateOnOrAfter(
        this.parseDate(calendar.projectStartDate),
        calendar,
      ),
    );

    if (target === start) {
      return 0;
    }

    const direction = target < start ? -1 : 1;
    let current = this.parseDate(start);
    let offset = 0;
    while (this.formatDate(current) !== target) {
      current = this.nextWorkingDate(current, calendar, direction);
      offset += direction;
    }
    return offset;
  }

  private finishDateToStartOffset(
    finishDate: string | null,
    calendar: CalendarContext,
    duration: number,
  ): number | null {
    const finishOffset = this.workingDateToOffset(finishDate, calendar);
    if (finishOffset === null) {
      return null;
    }
    return finishOffset - duration;
  }

  private firstWorkingDateOnOrAfter(
    date: Date,
    calendar: CalendarContext,
  ): Date {
    let current = date;
    while (!this.isWorkingDate(current, calendar)) {
      current = this.addDays(current, 1);
    }
    return current;
  }

  private nextWorkingDate(
    date: Date,
    calendar: CalendarContext,
    direction: 1 | -1,
  ): Date {
    let current = date;
    do {
      current = this.addDays(current, direction);
    } while (!this.isWorkingDate(current, calendar));
    return current;
  }

  private isWorkingDate(date: Date, calendar: CalendarContext): boolean {
    const isoDate = this.formatDate(date);
    const exception = calendar.exceptions.get(isoDate);
    if (exception !== undefined) {
      return exception;
    }
    return calendar.workingWeekdays.has(date.getUTCDay());
  }

  private parseDate(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private max(values: number[]): number {
    return values.length ? Math.max(...values) : 0;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
