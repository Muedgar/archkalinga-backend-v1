import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { ProjectMembership } from 'src/projects/entities';
import {
  Task,
  TaskActivitySchedule,
  TaskChecklistItem,
  TaskMaterial,
  TaskResourceAllocation,
} from '../entities';
import { TaskDashboardSummaryQueryDto } from '../dtos';
import { TASK_NOT_FOUND, TASK_PROJECT_ACCESS_DENIED } from '../messages';
import { TaskAuthService } from './task-auth.service';

type TaskDashboardBranchSummary = {
  taskId: string;
  title: string;
  statusId: string;
  status: {
    id: string;
    name: string;
    key: string;
    category: string;
    isTerminal: boolean;
  } | null;
  descendantCount: number;
  taskCount: number;
  completedTaskCount: number;
  completionPercentage: number;
  overdueCount: number;
  blockedCount: number;
  rollupProgress: number | null;
};

export type TaskDashboardSummaryResponse = {
  taskId: string;
  projectId: string;
  generatedAt: string;
  descendantCount: number;
  taskCount: number;
  leafTaskCount: number;
  completedTaskCount: number;
  completionPercentage: number;
  overdueCount: number;
  blockedCount: number;
  criticalPathExposure: {
    criticalTaskCount: number;
    scheduledTaskCount: number;
    criticalPercentage: number;
    hasCriticalExposure: boolean;
  };
  resources: {
    allocationCount: number;
    totalCostAmount: number;
    currency: string | null;
  };
  materials: {
    materialCount: number;
    totalMaterialCost: number;
    currency: string | null;
  };
  checklist: {
    itemCount: number;
    completedItemCount: number;
    branchedItemCount: number;
    completionPercentage: number;
  };
  progress: {
    self: number | null;
    rollup: number | null;
  };
  branches: TaskDashboardBranchSummary[];
  meta: {
    includeDeleted: boolean;
    includeSuperseded: boolean;
    includeCompleted: boolean;
  };
};

@Injectable()
export class TaskDashboardSummaryService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskChecklistItem)
    private readonly checklistRepo: Repository<TaskChecklistItem>,
    @InjectRepository(TaskActivitySchedule)
    private readonly scheduleRepo: Repository<TaskActivitySchedule>,
    @InjectRepository(TaskResourceAllocation)
    private readonly resourceRepo: Repository<TaskResourceAllocation>,
    @InjectRepository(TaskMaterial)
    private readonly materialRepo: Repository<TaskMaterial>,
    private readonly authSvc: TaskAuthService,
  ) {}

  async getSummary(
    projectId: string,
    taskId: string,
    query: TaskDashboardSummaryQueryDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<TaskDashboardSummaryResponse> {
    if (prefetchedMembership === undefined) {
      await this.authSvc.verifyProjectPermission(
        projectId,
        requestUser,
        'view',
      );
    }

    const includeDeleted =
      query.includeDeleted === true && this.authSvc.isAdmin(requestUser);
    const includeSuperseded = query.includeSuperseded === true;
    const includeCompleted = query.includeCompleted ?? true;
    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
    );

    const rootTasks = await this.loadTasksByIds(
      projectId,
      [taskId],
      requestUser,
      canViewAllProjectTasks,
      includeDeleted,
      true,
      true,
    );
    const rootTask = rootTasks[0];
    if (!rootTask) throw new NotFoundException(TASK_NOT_FOUND);

    const canViewRoot = await this.authSvc.canViewTask(rootTask, requestUser);
    if (!canViewRoot) throw new ForbiddenException(TASK_PROJECT_ACCESS_DENIED);

    const tasks = await this.loadVisibleSubtree(
      projectId,
      rootTask,
      requestUser,
      canViewAllProjectTasks,
      includeDeleted,
      includeSuperseded,
      includeCompleted,
    );
    const taskIds = tasks.map((task) => task.id);

    const [
      checklistSummary,
      criticalSummary,
      resourceSummary,
      materialSummary,
      schedulesByTaskId,
    ] = await Promise.all([
      this.loadChecklistSummary(taskIds),
      this.loadCriticalSummary(taskIds),
      this.loadResourceSummary(taskIds),
      this.loadMaterialSummary(taskIds),
      this.loadSchedulesByTaskId(taskIds),
    ]);

    const tree = this.buildTree(tasks);
    const rootNode = tree.get(rootTask.id)!;
    const rollupProgress = this.computeRollupProgress(rootNode);
    const completedTaskCount = tasks.filter((task) => task.completed).length;
    const leafTaskCount = tasks.filter(
      (task) => !tasks.some((candidate) => candidate.parentTaskId === task.id),
    ).length;
    const overdueCount = tasks.filter((task) =>
      this.isOverdue(task, schedulesByTaskId.get(task.id)),
    ).length;
    const blockedCount = tasks.filter((task) => this.isBlocked(task)).length;

    return {
      taskId: rootTask.id,
      projectId,
      generatedAt: new Date().toISOString(),
      descendantCount: tasks.length - 1,
      taskCount: tasks.length,
      leafTaskCount,
      completedTaskCount,
      completionPercentage: this.percentage(completedTaskCount, tasks.length),
      overdueCount,
      blockedCount,
      criticalPathExposure: criticalSummary,
      resources: resourceSummary,
      materials: materialSummary,
      checklist: checklistSummary,
      progress: {
        self: rootTask.progress ?? null,
        rollup: rollupProgress,
      },
      branches: rootNode.children.map((child) =>
        this.buildBranchSummary(child, schedulesByTaskId),
      ),
      meta: {
        includeDeleted,
        includeSuperseded,
        includeCompleted,
      },
    };
  }

  private async loadVisibleSubtree(
    projectId: string,
    rootTask: Task,
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
    includeDeleted: boolean,
    includeSuperseded: boolean,
    includeCompleted: boolean,
  ): Promise<Task[]> {
    const tasks = [rootTask];
    let frontierIds = [rootTask.id];

    for (let depth = 0; depth < 25 && frontierIds.length; depth += 1) {
      const children = await this.loadTasksByParentIds(
        projectId,
        frontierIds,
        requestUser,
        canViewAllProjectTasks,
        includeDeleted,
        includeSuperseded,
        includeCompleted,
      );
      tasks.push(...children);
      frontierIds = children.map((child) => child.id);
    }

    return tasks;
  }

  private async loadTasksByIds(
    projectId: string,
    taskIds: string[],
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
    includeDeleted: boolean,
    includeSuperseded: boolean,
    includeCompleted: boolean,
  ): Promise<Task[]> {
    return this.loadTasks(
      projectId,
      'id',
      taskIds,
      requestUser,
      canViewAllProjectTasks,
      includeDeleted,
      includeSuperseded,
      includeCompleted,
    );
  }

  private async loadTasksByParentIds(
    projectId: string,
    parentTaskIds: string[],
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
    includeDeleted: boolean,
    includeSuperseded: boolean,
    includeCompleted: boolean,
  ): Promise<Task[]> {
    return this.loadTasks(
      projectId,
      'parentTaskId',
      parentTaskIds,
      requestUser,
      canViewAllProjectTasks,
      includeDeleted,
      includeSuperseded,
      includeCompleted,
    );
  }

  private async loadTasks(
    projectId: string,
    field: 'id' | 'parentTaskId',
    ids: string[],
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
    includeDeleted: boolean,
    includeSuperseded: boolean,
    includeCompleted: boolean,
  ): Promise<Task[]> {
    if (!ids.length) return [];

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignees', 'assignees')
      .leftJoinAndSelect('task.status', 'status')
      .where(`task.${field} IN (:...ids)`, { ids })
      .andWhere('task.projectId = :projectId', { projectId });

    if (!includeDeleted) qb.andWhere('task.deletedAt IS NULL');
    if (!includeSuperseded) qb.andWhere('task.supersededByTaskId IS NULL');
    if (!includeCompleted) qb.andWhere('task.completed = false');
    this.authSvc.applyTaskVisibilityScope(
      qb,
      requestUser,
      canViewAllProjectTasks,
    );

    return qb
      .orderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
      .addOrderBy('task.rank', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC')
      .getMany();
  }

  private async loadChecklistSummary(
    taskIds: string[],
  ): Promise<TaskDashboardSummaryResponse['checklist']> {
    if (!taskIds.length) {
      return {
        itemCount: 0,
        completedItemCount: 0,
        branchedItemCount: 0,
        completionPercentage: 0,
      };
    }

    const row = await this.checklistRepo
      .createQueryBuilder('item')
      .select('COUNT(item.id)', 'itemCount')
      .addSelect(
        `SUM(CASE WHEN item.completed = true THEN 1 ELSE 0 END)`,
        'completedItemCount',
      )
      .addSelect(
        `SUM(CASE WHEN item.branchedTaskId IS NOT NULL THEN 1 ELSE 0 END)`,
        'branchedItemCount',
      )
      .where('item.taskId IN (:...taskIds)', { taskIds })
      .getRawOne<{
        itemCount: string | null;
        completedItemCount: string | null;
        branchedItemCount: string | null;
      }>();

    const itemCount = Number(row?.itemCount ?? 0);
    const completedItemCount = Number(row?.completedItemCount ?? 0);
    return {
      itemCount,
      completedItemCount,
      branchedItemCount: Number(row?.branchedItemCount ?? 0),
      completionPercentage: this.percentage(completedItemCount, itemCount),
    };
  }

  private async loadCriticalSummary(
    taskIds: string[],
  ): Promise<TaskDashboardSummaryResponse['criticalPathExposure']> {
    if (!taskIds.length) {
      return {
        criticalTaskCount: 0,
        scheduledTaskCount: 0,
        criticalPercentage: 0,
        hasCriticalExposure: false,
      };
    }

    const row = await this.scheduleRepo
      .createQueryBuilder('schedule')
      .select('COUNT(schedule.id)', 'scheduledTaskCount')
      .addSelect(
        `SUM(CASE WHEN schedule.isCritical = true THEN 1 ELSE 0 END)`,
        'criticalTaskCount',
      )
      .where('schedule.taskId IN (:...taskIds)', { taskIds })
      .getRawOne<{
        scheduledTaskCount: string | null;
        criticalTaskCount: string | null;
      }>();

    const scheduledTaskCount = Number(row?.scheduledTaskCount ?? 0);
    const criticalTaskCount = Number(row?.criticalTaskCount ?? 0);
    return {
      criticalTaskCount,
      scheduledTaskCount,
      criticalPercentage: this.percentage(
        criticalTaskCount,
        scheduledTaskCount,
      ),
      hasCriticalExposure: criticalTaskCount > 0,
    };
  }

  private async loadResourceSummary(
    taskIds: string[],
  ): Promise<TaskDashboardSummaryResponse['resources']> {
    if (!taskIds.length) {
      return { allocationCount: 0, totalCostAmount: 0, currency: null };
    }

    const row = await this.resourceRepo
      .createQueryBuilder('allocation')
      .select('COUNT(allocation.id)', 'allocationCount')
      .addSelect('COALESCE(SUM(allocation.costAmount), 0)', 'totalCostAmount')
      .addSelect('MIN(allocation.currency)', 'currency')
      .where('allocation.taskId IN (:...taskIds)', { taskIds })
      .getRawOne<{
        allocationCount: string | null;
        totalCostAmount: string | null;
        currency: string | null;
      }>();

    return {
      allocationCount: Number(row?.allocationCount ?? 0),
      totalCostAmount: Number(row?.totalCostAmount ?? 0),
      currency: row?.currency ?? null,
    };
  }

  private async loadMaterialSummary(
    taskIds: string[],
  ): Promise<TaskDashboardSummaryResponse['materials']> {
    if (!taskIds.length) {
      return { materialCount: 0, totalMaterialCost: 0, currency: null };
    }

    const row = await this.materialRepo
      .createQueryBuilder('material')
      .select('COUNT(material.id)', 'materialCount')
      .addSelect('COALESCE(SUM(material.materialCost), 0)', 'totalMaterialCost')
      .addSelect('MIN(material.currency)', 'currency')
      .where('material.taskId IN (:...taskIds)', { taskIds })
      .getRawOne<{
        materialCount: string | null;
        totalMaterialCost: string | null;
        currency: string | null;
      }>();

    return {
      materialCount: Number(row?.materialCount ?? 0),
      totalMaterialCost: Number(row?.totalMaterialCost ?? 0),
      currency: row?.currency ?? null,
    };
  }

  private async loadSchedulesByTaskId(
    taskIds: string[],
  ): Promise<Map<string, TaskActivitySchedule>> {
    if (!taskIds.length) return new Map();
    const schedules = await this.scheduleRepo.find({
      where: { taskId: In(taskIds) },
    });
    return new Map(schedules.map((schedule) => [schedule.taskId, schedule]));
  }

  private buildTree(tasks: Task[]): Map<string, Task & { children: Task[] }> {
    const nodes = new Map<string, Task & { children: Task[] }>();
    for (const task of tasks)
      nodes.set(task.id, Object.assign(task, { children: [] }));
    for (const task of tasks) {
      if (!task.parentTaskId) continue;
      const parent = nodes.get(task.parentTaskId);
      const child = nodes.get(task.id);
      if (parent && child) parent.children.push(child);
    }
    return nodes;
  }

  private buildBranchSummary(
    branch: Task & { children: Task[] },
    schedulesByTaskId: Map<string, TaskActivitySchedule>,
  ): TaskDashboardBranchSummary {
    const tasks = this.flatten(branch);
    const completedTaskCount = tasks.filter((task) => task.completed).length;
    return {
      taskId: branch.id,
      title: branch.title,
      statusId: branch.statusId,
      status: branch.status
        ? {
            id: branch.status.id,
            name: branch.status.name,
            key: branch.status.key,
            category: branch.status.category,
            isTerminal: branch.status.isTerminal,
          }
        : null,
      descendantCount: tasks.length - 1,
      taskCount: tasks.length,
      completedTaskCount,
      completionPercentage: this.percentage(completedTaskCount, tasks.length),
      overdueCount: tasks.filter((task) =>
        this.isOverdue(task, schedulesByTaskId.get(task.id)),
      ).length,
      blockedCount: tasks.filter((task) => this.isBlocked(task)).length,
      rollupProgress: this.computeRollupProgress(branch),
    };
  }

  private flatten(root: Task & { children: Task[] }): Task[] {
    const result: Task[] = [];
    const stack = [root];
    while (stack.length) {
      const task = stack.pop()!;
      result.push(task);
      stack.push(...((task.children as Task[]) ?? []));
    }
    return result;
  }

  private computeRollupProgress(
    root: Task & { children: Task[] },
  ): number | null {
    const tasks = this.flatten(root).filter((task) => task.progress !== null);
    if (!tasks.length) return null;
    const total = tasks.reduce((sum, task) => sum + (task.progress ?? 0), 0);
    return Math.round(total / tasks.length);
  }

  private isOverdue(task: Task, schedule?: TaskActivitySchedule): boolean {
    if (task.completed) return false;
    const dueDate = task.endDate ?? schedule?.plannedEndDate ?? null;
    if (!dueDate) return false;
    return dueDate < new Date().toISOString().slice(0, 10);
  }

  private isBlocked(task: Task): boolean {
    const status = task.status;
    if (!status) return false;
    const key = `${status.key ?? ''} ${status.name ?? ''}`.toLowerCase();
    return key.includes('blocked') || key.includes('blocker');
  }

  private percentage(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 100);
  }
}
