import { ConflictException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { TaskWorkflowActivation, Task, TaskChecklistItem } from '../entities';
import {
  CanonicalStage,
  ProjectStatus,
} from '../project-config/project-status.entity';

export const STAGES = [
  CanonicalStage.TODO,
  CanonicalStage.IN_PROGRESS,
  CanonicalStage.IN_REVIEW,
  CanonicalStage.DONE,
];
export function conflict(code: string, details?: unknown): never {
  throw new ConflictException({ code, message: code, details });
}
export async function lockWorkflow(
  tx: EntityManager,
  projectId: string,
): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `task-workflow:${projectId}`,
  ]);
}
export function reduceStages(stages: CanonicalStage[]): CanonicalStage {
  return stages.length
    ? STAGES[Math.min(...stages.map((s) => STAGES.indexOf(s)))]
    : CanonicalStage.TODO;
}
export function activeStage(
  previous: string,
  target: CanonicalStage | null,
): CanonicalStage {
  if (target) return target;
  return previous === String(CanonicalStage.TODO)
    ? CanonicalStage.TODO
    : CanonicalStage.IN_PROGRESS;
}
export async function canonicalStatuses(
  tx: EntityManager,
  projectId: string,
): Promise<Map<CanonicalStage, ProjectStatus>> {
  const activation = await tx.findOne(TaskWorkflowActivation, {
    where: { projectId, activatedAt: IsNull() },
  });
  if (activation) {
    const [setting] = await tx.query<{ enabled: string | null }[]>(
      "SELECT current_setting('app.workflow_backfill', true) AS enabled",
    );
    if (setting.enabled !== 'on') conflict('WORKFLOW_MIGRATION_REQUIRED');
  }
  const statuses = await tx.find(ProjectStatus, {
    where: { projectId, isActive: true },
  });
  const map = new Map(
    statuses.filter((s) => s.canonicalStage).map((s) => [s.canonicalStage!, s]),
  );
  if (
    STAGES.some((s) => !map.has(s)) ||
    statuses.some(
      (s) => s.isDone !== (s.canonicalStage === CanonicalStage.DONE),
    )
  )
    conflict('WORKFLOW_MIGRATION_REQUIRED');
  return map;
}
export async function assertOpenHierarchy(
  tx: EntityManager,
  projectId: string,
  taskId?: string | null,
): Promise<void> {
  const seen = new Set<string>();
  while (taskId) {
    if (seen.has(taskId)) conflict('INVALID_TASK_HIERARCHY');
    seen.add(taskId);
    const task = await tx.findOne(Task, {
      where: { id: taskId, projectId, deletedAt: IsNull() },
    });
    if (!task) conflict('INVALID_TASK_HIERARCHY');
    if (task.completed) conflict('COMPLETED_TASK_STRUCTURE_IS_TERMINAL');
    taskId = task.parentTaskId;
  }
}
/** Caller holds the project workflow lock. All work participates, irrespective of actor visibility. */
export async function rollupStatuses(tx: EntityManager, projectId: string) {
  const statuses = await canonicalStatuses(tx, projectId);
  const tasks = await tx.find(Task, {
    where: { projectId, deletedAt: IsNull() },
    relations: ['status'],
  });
  const items = await tx
    .createQueryBuilder(TaskChecklistItem, 'item')
    .innerJoin(Task, 'task', 'task.id = item.taskId')
    .where('task.projectId = :projectId', { projectId })
    .andWhere('task.deletedAt IS NULL')
    .getMany();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visiting = new Set<string>(),
    stages = new Map<string, CanonicalStage>();
  const changedTasks: Task[] = [],
    changedItems: TaskChecklistItem[] = [];
  const visit = (task: Task): CanonicalStage => {
    if (stages.has(task.id)) return stages.get(task.id)!;
    if (visiting.has(task.id)) conflict('INVALID_TASK_HIERARCHY');
    visiting.add(task.id);
    const children = tasks.filter((t) => t.parentTaskId === task.id);
    const work = items
      .filter((i) => i.taskId === task.id && !i.branchedTaskId)
      .map((i) =>
        i.completed
          ? CanonicalStage.DONE
          : (i.effectiveStage as CanonicalStage),
      );
    for (const child of children) work.push(visit(child));
    for (const source of items.filter(
      (i) => i.taskId === task.id && i.branchedTaskId,
    )) {
      const child = byId.get(source.branchedTaskId!);
      if (!child || child.parentTaskId !== task.id)
        conflict('INVALID_BRANCH_LINK');
      const stage = visit(child);
      const status = statuses.get(stage)!;
      if (
        source.statusId !== status.id ||
        source.completed !== (stage === CanonicalStage.DONE)
      ) {
        source.statusId = status.id;
        source.effectiveStage = stage;
        source.completed = stage === CanonicalStage.DONE;
        source.completedAt = source.completed ? child.completedAt : null;
        source.completedByUserId = null;
        changedItems.push(source);
      }
    }
    const next = task.completed ? CanonicalStage.DONE : reduceStages(work);
    const status = statuses.get(next)!;
    if (
      task.statusId !== status.id ||
      task.completed !== (next === CanonicalStage.DONE)
    ) {
      task.statusId = status.id;
      task.status = status;
      task.completed = next === CanonicalStage.DONE;
      task.completedAt = task.completed
        ? (task.completedAt ?? new Date())
        : null;
      task.completedByUserId = null;
      if (task.completed) task.progress = 100;
      changedTasks.push(task);
    }
    visiting.delete(task.id);
    stages.set(task.id, next);
    return next;
  };
  tasks.forEach(visit);
  if (changedItems.length) await tx.save(TaskChecklistItem, changedItems);
  if (changedTasks.length) await tx.save(Task, changedTasks);
  return { changedTasks, changedItems };
}
