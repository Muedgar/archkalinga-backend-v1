import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { Task, TaskChecklistItem } from '../entities';

type ChecklistProgressItem = Pick<
  TaskChecklistItem,
  'completed' | 'branchedTaskId'
>;

@Injectable()
export class TaskProgressService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskChecklistItem)
    private readonly checklistRepo: Repository<TaskChecklistItem>,
  ) {}

  calculateTaskProgress(
    task: Pick<Task, 'id' | 'completed'>,
    checklistByTaskId: Map<string, ChecklistProgressItem[]>,
    progressByTaskId: Map<string, number>,
  ): number {
    const items = checklistByTaskId.get(task.id) ?? [];
    if (!items.length) return task.completed ? 100 : 0;

    const completedSlots = items.reduce((sum, item) => {
      if (item.branchedTaskId) {
        const childProgress = progressByTaskId.get(item.branchedTaskId);
        return (
          sum +
          (childProgress === undefined
            ? Number(item.completed)
            : childProgress / 100)
        );
      }
      return sum + Number(item.completed);
    }, 0);

    return Math.round((completedSlots / items.length) * 100);
  }

  calculateProjectProgress(tasks: Pick<Task, 'progress'>[]): number {
    if (!tasks.length) return 0;

    const total = tasks.reduce((sum, task) => sum + (task.progress ?? 0), 0);
    return Math.round(total / tasks.length);
  }

  async recalculateProjectTaskProgress(
    manager: EntityManager,
    projectId: string,
  ): Promise<Map<string, number>> {
    const [tasks, checklistItems] = await Promise.all([
      manager.find(Task, {
        where: { projectId, deletedAt: IsNull() },
        select: [
          'pkid',
          'id',
          'projectId',
          'parentTaskId',
          'progress',
          'completed',
        ],
      }),
      manager.find(TaskChecklistItem, {
        where: { task: { projectId, deletedAt: IsNull() } },
        relations: ['task'],
      }),
    ]);

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const childrenByParentId = new Map<string | null, Task[]>();
    const checklistByTaskId = new Map<string, TaskChecklistItem[]>();
    const progressByTaskId = new Map<string, number>();

    for (const task of tasks) {
      const bucket = childrenByParentId.get(task.parentTaskId ?? null) ?? [];
      bucket.push(task);
      childrenByParentId.set(task.parentTaskId ?? null, bucket);
    }

    for (const item of checklistItems) {
      const bucket = checklistByTaskId.get(item.taskId) ?? [];
      bucket.push(item);
      checklistByTaskId.set(item.taskId, bucket);
    }

    const visited = new Set<string>();
    const visit = (task: Task): number => {
      if (visited.has(task.id)) return progressByTaskId.get(task.id) ?? 0;
      visited.add(task.id);

      for (const child of childrenByParentId.get(task.id) ?? []) {
        visit(child);
      }

      const progress = this.calculateTaskProgress(
        task,
        checklistByTaskId,
        progressByTaskId,
      );
      progressByTaskId.set(task.id, progress);
      return progress;
    };

    for (const task of tasks) visit(task);

    const tasksToSave = tasks.filter(
      (task) => task.progress !== (progressByTaskId.get(task.id) ?? 0),
    );
    for (const task of tasksToSave) {
      task.progress = progressByTaskId.get(task.id) ?? 0;
    }

    const itemsToSave = checklistItems.filter((item) => {
      if (!item.branchedTaskId || !taskById.has(item.branchedTaskId)) {
        return false;
      }

      const childComplete =
        (progressByTaskId.get(item.branchedTaskId) ?? 0) >= 100;
      if (item.completed === childComplete) return false;

      item.completed = childComplete;
      item.completedByUserId = null;
      item.completedAt = childComplete
        ? (item.completedAt ?? new Date())
        : null;
      return true;
    });

    if (tasksToSave.length) await manager.save(Task, tasksToSave);
    if (itemsToSave.length) await manager.save(TaskChecklistItem, itemsToSave);

    return progressByTaskId;
  }

  async recalculateProjectTaskProgressByTaskId(
    manager: EntityManager,
    taskId: string,
  ): Promise<Map<string, number>> {
    const task = await manager.findOne(Task, {
      where: { id: taskId, deletedAt: IsNull() },
      select: ['id', 'projectId'],
    });
    if (!task) return new Map();
    return this.recalculateProjectTaskProgress(manager, task.projectId);
  }

  async loadProjectProgressMap(
    projectIds: string[],
  ): Promise<Map<string, number>> {
    const uniqueProjectIds = [...new Set(projectIds)].filter(Boolean);
    if (!uniqueProjectIds.length) return new Map();

    const rows = await this.taskRepo
      .createQueryBuilder('task')
      .select('task.projectId', 'projectId')
      .addSelect(
        'COALESCE(ROUND(AVG(COALESCE(task.progress, 0))), 0)',
        'progress',
      )
      .where('task.projectId IN (:...projectIds)', {
        projectIds: uniqueProjectIds,
      })
      .andWhere('task.deletedAt IS NULL')
      .groupBy('task.projectId')
      .getRawMany<{ projectId: string; progress: string | number | null }>();

    return new Map(
      uniqueProjectIds.map((projectId) => {
        const row = rows.find((candidate) => candidate.projectId === projectId);
        return [projectId, Number(row?.progress ?? 0)];
      }),
    );
  }
}
