import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { Task } from '../entities';

@Injectable()
export class TaskProgressService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
  ) {}

  calculateTaskProgress(
    task: Pick<Task, 'id' | 'completed' | 'progress'>,
    childrenByParentId: Map<string | null, Pick<Task, 'id'>[]>,
    progressByTaskId: Map<string, number>,
  ): number {
    const children = childrenByParentId.get(task.id) ?? [];
    if (children.length > 0) {
      const total = children.reduce(
        (sum, child) => sum + (progressByTaskId.get(child.id) ?? 0),
        0,
      );
      return Math.round(total / children.length);
    }

    return task.completed ? 100 : (task.progress ?? 0);
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
    const tasks = await manager.find(Task, {
      where: { projectId, deletedAt: IsNull() },
      select: [
        'pkid',
        'id',
        'projectId',
        'parentTaskId',
        'progress',
        'completed',
      ],
    });

    const childrenByParentId = new Map<string | null, Task[]>();
    const progressByTaskId = new Map<string, number>();

    for (const task of tasks) {
      const bucket = childrenByParentId.get(task.parentTaskId ?? null) ?? [];
      bucket.push(task);
      childrenByParentId.set(task.parentTaskId ?? null, bucket);
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
        childrenByParentId,
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

    if (tasksToSave.length) await manager.save(Task, tasksToSave);

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
      .andWhere('task.parentTaskId IS NULL')
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
