import { lockWorkflow } from '../workflow/workflow-domain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { Project } from 'src/projects/entities';
import {
  ChecklistDependency,
  TaskChecklistItem,
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
  manualPlannedStartOffset: number | null;
  manualPlannedEndOffset: number | null;
  drivingPredecessorIds: Set<string>;
  successorPressureIds: Set<string>;
};

type ScheduledTask = Pick<
  Task,
  'id' | 'parentTaskId' | 'scheduleType' | 'startDate' | 'endDate'
>;

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
    manager?: EntityManager,
    lockHeld = false,
  ): Promise<{
    calculationRunId: string;
    projectId: string;
    taskCount: number;
    dependencyCount: number;
    summaryRollupTaskCount: number;
    projectDurationDays: number;
    criticalTaskIds: string[];
  }> {
    if (!manager && !lockHeld)
      return this.taskRepo.manager.transaction(async (tx) => {
        await lockWorkflow(tx, projectId);
        return this.recalculateProject(projectId, dto, tx);
      });
    if (manager) {
      await lockWorkflow(manager, projectId);
      const scoped = new ScheduleCalculationService(
        manager.getRepository(Project),
        manager.getRepository(Task),
        manager.getRepository(ProjectCalendar),
        manager.getRepository(ProjectCalendarException),
        manager.getRepository(TaskDependency),
        manager.getRepository(TaskActivitySchedule),
        manager.getRepository(TaskScheduleCalculationRun),
        manager.getRepository(TaskScheduleExplanation),
      );
      return scoped.recalculateProject(projectId, dto, undefined, true);
    }
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
      select: ['id', 'parentTaskId', 'scheduleType', 'startDate', 'endDate'],
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

    const schedules = await this.scheduleRepo.find({
      where: { taskId: In(taskIds) },
    });
    const checklistItems = await this.taskRepo.manager.find(TaskChecklistItem, {
      where: { taskId: In(taskIds), packageManaged: true },
    });
    const checklistEdges = checklistItems.length
      ? await this.taskRepo.manager.find(ChecklistDependency, {
          where: { checklistItemId: In(checklistItems.map((i) => i.id)) },
        })
      : [];
    const calendar = await this.loadCalendarContext(projectId, tasks, [
      ...schedules,
      ...checklistItems.map(
        (i) =>
          ({ earliestStartDate: i.earliestStartDate }) as TaskActivitySchedule,
      ),
    ]);
    let nodes = this.buildNodes(schedules, calendar);
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
    let summaryRollupTaskCount: number;
    let projectDurationDays: number;
    if (checklistItems.length) {
      nodes = this.calculateChecklistGraph(
        tasks,
        schedules,
        checklistItems,
        edges,
        checklistEdges,
        calendar,
      );
      projectDurationDays = this.max(
        [...nodes.values()].map((node) => node.ef),
      );
      summaryRollupTaskCount = [...nodes.values()].filter(
        (node) => node.isSummaryRollup,
      ).length;
    } else {
      const { topologicalOrder, incoming, outgoing } = this.sortGraph(
        nodes,
        edges,
      );
      this.forwardPass(topologicalOrder, nodes, incoming);
      projectDurationDays = this.max(
        [...nodes.values()].map((node) => node.ef),
      );
      this.backwardPass(
        [...topologicalOrder].reverse(),
        nodes,
        outgoing,
        projectDurationDays,
      );
      this.computeFloats(nodes, outgoing);
      summaryRollupTaskCount = this.rollupSummaryRows(tasks, nodes);
    }
    const taskNodes = [...nodes.values()].filter(
      (node) => !node.taskId.startsWith('checklist:'),
    );
    const now = new Date();
    const schedulesToSave = taskNodes.map((node) => {
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
        const plannedStart =
          node.manualPlannedStartOffset ??
          (node.manualPlannedEndOffset !== null
            ? node.manualPlannedEndOffset - duration
            : null) ??
          earlyStart;
        const plannedEnd =
          node.manualPlannedEndOffset ??
          (node.manualPlannedStartOffset !== null
            ? node.manualPlannedStartOffset + duration
            : null) ??
          earlyFinish;
        node.schedule.plannedStartOffset = this.round(plannedStart);
        node.schedule.plannedEndOffset = this.round(plannedEnd);
        node.schedule.plannedStartDate = this.offsetToWorkingDate(
          plannedStart,
          calendar,
        );
        node.schedule.plannedEndDate = this.offsetToWorkingDate(
          plannedEnd,
          calendar,
        );
      } else {
        node.schedule.plannedStartOffset = earlyStart;
        node.schedule.plannedEndOffset = earlyFinish;
        node.schedule.plannedStartDate = node.schedule.earlyStartDate;
        node.schedule.plannedEndDate = node.schedule.earlyFinishDate;
      }
      node.schedule.totalFloatDays = this.round(node.totalFloat);
      node.schedule.freeFloatDays = this.round(node.freeFloat);
      node.schedule.isCritical = node.isCritical;
      node.schedule.calculatedAt = now;
      return node.schedule;
    });

    const explanations = taskNodes.map((node) =>
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
      for (const item of checklistItems) {
        const node = nodes.get(`checklist:${item.id}`)!;
        await tx.update(
          TaskChecklistItem,
          { id: item.id },
          {
            plannedStartDate: this.offsetToWorkingDate(node.es, calendar),
            plannedEndDate: this.offsetToWorkingDate(node.ef, calendar),
          },
        );
      }
      await Promise.all(
        schedulesToSave.map((schedule) =>
          tx.update(
            Task,
            { id: schedule.taskId },
            {
              startDate: schedule.plannedStartDate,
              endDate: schedule.plannedEndDate,
            },
          ),
        ),
      );
      await tx.delete(TaskScheduleExplanation, { calculationRunId });
      await tx.save(TaskScheduleExplanation, explanations);
    });

    const criticalTaskIds = taskNodes
      .filter((node) => node.isCritical)
      .map((node) => node.taskId);

    return {
      taskCount: taskNodes.length,
      dependencyCount: edges.length + checklistEdges.length,
      summaryRollupTaskCount,
      projectDurationDays: this.round(projectDurationDays),
      criticalTaskIds,
    };
  }

  /** Schedule checklist work in memory; only real task/checklist rows are persisted. */
  private calculateChecklistGraph(
    tasks: ScheduledTask[],
    schedules: TaskActivitySchedule[],
    items: TaskChecklistItem[],
    taskEdges: CpmEdge[],
    checklistEdges: ChecklistDependency[],
    calendar: CalendarContext,
  ): Map<string, CpmNode> {
    const itemKey = (id: string) => `checklist:${id}`;
    const nodes = this.buildNodes(
      [
        ...schedules,
        ...items.map((item) =>
          Object.assign(new TaskActivitySchedule(), {
            taskId: itemKey(item.id),
            durationDays: item.durationDays,
            earliestStartDate: item.earliestStartDate,
            isManuallyScheduled: false,
          }),
        ),
      ],
      calendar,
    );
    const aliases = new Map(
      items
        .filter((i) => i.branchedTaskId && nodes.has(i.branchedTaskId))
        .map((i) => [itemKey(i.id), i.branchedTaskId!]),
    );
    const resolve = (id: string) => aliases.get(id) ?? id;
    const children = new Map<string, Set<string>>();
    const addChild = (parent: string | null, child: string) => {
      if (!parent || !nodes.has(parent) || !nodes.has(child)) return;
      const bucket = children.get(parent) ?? new Set<string>();
      bucket.add(resolve(child));
      children.set(parent, bucket);
    };
    for (const task of tasks) addChild(task.parentTaskId, task.id);
    for (const item of items) addChild(item.taskId, itemKey(item.id));
    type Event = { early: number; late: number };
    const events = new Map<string, Event>();
    const constraints: { from: string; to: string; lag: number }[] = [];
    const start = (id: string) => `${resolve(id)}:start`;
    const end = (id: string) => `${resolve(id)}:end`;
    for (const [id, node] of nodes) {
      if (aliases.has(id)) continue;
      events.set(start(id), { early: node.es, late: 0 });
      events.set(end(id), { early: node.es, late: 0 });
    }
    for (const alias of aliases.keys()) {
      const event = events.get(start(alias))!;
      event.early = Math.max(event.early, nodes.get(alias)!.es);
    }
    const edge = (from: string, to: string, lag = 0) => {
      if (events.has(from) && events.has(to))
        constraints.push({ from, to, lag });
    };
    for (const [id, node] of nodes) {
      if (aliases.has(id)) continue;
      const childIds = children.get(id);
      if (childIds?.size) {
        node.isSummaryRollup = true;
        edge(start(id), end(id));
        for (const child of childIds) {
          edge(start(id), start(child));
          edge(end(child), end(id));
        }
      } else {
        edge(start(id), end(id), node.duration);
        edge(end(id), start(id), -node.duration);
      }
    }
    const addDependency = (
      from: string,
      to: string,
      type: DependencyType,
      lag: number,
    ) => {
      edge(
        type[0] === 'F' ? end(from) : start(from),
        type[1] === 'F' ? end(to) : start(to),
        lag,
      );
    };
    taskEdges.forEach((e) =>
      addDependency(
        e.predecessorId,
        e.successorId,
        e.dependencyType,
        e.lagDays,
      ),
    );
    checklistEdges.forEach((e) =>
      addDependency(
        itemKey(e.dependsOnChecklistItemId),
        itemKey(e.checklistItemId),
        e.dependencyType,
        e.lagDays,
      ),
    );
    // Bidirectional duration bounds keep leaf durations fixed when FF/SF constraints move a finish.
    // Relaxation also handles summary start/finish events without manufacturing child Tasks.
    const maxPasses = Math.max(1, events.size * 2);
    for (let pass = 0; pass < maxPasses; pass++) {
      let changed = false;
      const raise = (key: string, value: number) => {
        const event = events.get(key)!;
        if (value > event.early + ScheduleCalculationService.EPSILON) {
          event.early = value;
          changed = true;
        }
      };
      for (const c of constraints)
        raise(c.to, events.get(c.from)!.early + c.lag);
      for (const [id, childIds] of children) {
        const list = [...childIds];
        raise(
          start(id),
          Math.min(...list.map((child) => events.get(start(child))!.early)),
        );
        const latestChild = list.reduce((a, b) =>
          events.get(end(a))!.early >= events.get(end(b))!.early ? a : b,
        );
        raise(end(latestChild), events.get(end(id))!.early);
      }
      if (!changed) break;
      if (pass === maxPasses - 1)
        throw new BadRequestException(
          'Checklist/task scheduling constraints contain an incompatible cycle',
        );
    }
    const finish = Math.max(0, ...[...events.values()].map((e) => e.early));
    for (const event of events.values()) event.late = finish;
    for (let pass = 0; pass < events.size; pass++) {
      let changed = false;
      for (const c of constraints) {
        const from = events.get(c.from)!;
        const candidate = events.get(c.to)!.late - c.lag;
        if (candidate < from.late - ScheduleCalculationService.EPSILON) {
          from.late = candidate;
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const [id, node] of nodes) {
      node.es = events.get(start(id))!.early;
      node.ef = events.get(end(id))!.early;
      node.ls = events.get(start(id))!.late;
      node.lf = events.get(end(id))!.late;
      node.duration = node.ef - node.es;
      node.totalFloat = Math.max(0, node.ls - node.es);
      node.freeFloat = node.totalFloat;
      node.isCritical = node.totalFloat < ScheduleCalculationService.EPSILON;
    }
    return nodes;
  }

  private buildNodes(
    schedules: TaskActivitySchedule[],
    calendar: CalendarContext,
  ): Map<string, CpmNode> {
    return new Map(
      schedules.map((schedule) => {
        const scheduledDuration = Math.max(0, schedule.durationDays ?? 0);
        const manualPlannedStartOffset = schedule.isManuallyScheduled
          ? (this.workingDateToOffset(schedule.plannedStartDate, calendar) ??
            schedule.plannedStartOffset ??
            null)
          : null;
        const manualPlannedEndOffset = schedule.isManuallyScheduled
          ? (this.workingDateToOffset(schedule.plannedEndDate, calendar) ??
            schedule.plannedEndOffset ??
            null)
          : null;
        const duration =
          schedule.isManuallyScheduled &&
          manualPlannedStartOffset !== null &&
          manualPlannedEndOffset !== null
            ? Math.max(0, manualPlannedEndOffset - manualPlannedStartOffset)
            : scheduledDuration;
        const pinnedStart = schedule.isManuallyScheduled
          ? (manualPlannedStartOffset ??
            (manualPlannedEndOffset !== null
              ? manualPlannedEndOffset - duration
              : null) ??
            0)
          : Math.max(
              0,
              this.workingDateToOffset(schedule.earliestStartDate, calendar) ??
                0,
            );
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
          manualPlannedStartOffset,
          manualPlannedEndOffset,
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
    tasks: ScheduledTask[],
    schedules: TaskActivitySchedule[],
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
      projectStartDate:
        project?.startDate ??
        this.firstAvailableScheduleAnchor(tasks, schedules),
      workingWeekdays,
      exceptions,
    };
  }

  private firstAvailableScheduleAnchor(
    tasks: ScheduledTask[],
    schedules: TaskActivitySchedule[],
  ): string | null {
    const dates = [
      ...tasks.flatMap((task) => [task.startDate, task.endDate]),
      ...schedules.flatMap((schedule) => [
        schedule.earliestStartDate,
        schedule.plannedStartDate,
        schedule.plannedEndDate,
        schedule.earlyStartDate,
        schedule.earlyFinishDate,
        schedule.lateStartDate,
        schedule.lateFinishDate,
        schedule.actualStartDate,
        schedule.actualEndDate,
      ]),
    ].filter((date): date is string => Boolean(date));

    return dates.sort()[0] ?? null;
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
