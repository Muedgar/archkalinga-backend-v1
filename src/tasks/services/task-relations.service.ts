import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { User } from 'src/users/entities';
import {
  DependencyType,
  RelationType,
  Task,
  TaskActionType,
  TaskDependency,
  TaskRelation,
  TaskViewMetadata,
  ViewType,
} from '../entities';
import { AddDependencyDto, AddRelationDto, CreateTaskDto } from '../dtos';
import {
  INVALID_TASK_DEPENDENCY,
  INVALID_TASK_RELATION,
  TASK_DEPENDENCY_NOT_FOUND,
  TASK_NOT_FOUND,
  TASK_RELATION_NOT_FOUND,
  TASK_RELATION_SELF,
} from '../messages';
import {
  TaskDependencyDetailSerializer,
  TaskRelationDetailSerializer,
} from '../serializers';
import { TaskActivityService } from './task-activity.service';

@Injectable()
export class TaskRelationsService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskDependency)
    private readonly dependencyRepo: Repository<TaskDependency>,
    @InjectRepository(TaskRelation)
    private readonly taskRelationRepo: Repository<TaskRelation>,
    @InjectRepository(TaskViewMetadata)
    private readonly taskViewMetadataRepo: Repository<TaskViewMetadata>,
    private readonly activitySvc: TaskActivityService,
  ) {}

  // ── Serializers ───────────────────────────────────────────────────────────

  private serializeDependency(dep: Partial<TaskDependency>): TaskDependencyDetailSerializer {
    return plainToInstance(TaskDependencyDetailSerializer, dep, { excludeExtraneousValues: true });
  }

  private serializeRelation(rel: Partial<TaskRelation>): TaskRelationDetailSerializer {
    return plainToInstance(TaskRelationDetailSerializer, rel, { excludeExtraneousValues: true });
  }

  // ── Private loaders ───────────────────────────────────────────────────────

  async getDependencyOrFail(taskId: string, depId: string): Promise<TaskDependency> {
    const dep = await this.dependencyRepo.findOne({ where: { id: depId, taskId } });
    if (!dep) throw new NotFoundException(TASK_DEPENDENCY_NOT_FOUND);
    return dep;
  }

  async getRelationOrFail(taskId: string, relationId: string): Promise<TaskRelation> {
    const r = await this.taskRelationRepo.findOne({
      where: { id: relationId, taskId },
      relations: ['relatedTask'],
    });
    if (!r) throw new NotFoundException(TASK_RELATION_NOT_FOUND);
    return r;
  }

  async findTaskOrFail(taskId: string, projectId: string): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
    });
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    return task;
  }

  // ── Cycle detection ───────────────────────────────────────────────────────

  async ensureNoDependencyCycle(
    manager: EntityManager,
    taskId: string,
    dependsOnTaskId: string,
  ): Promise<void> {
    if (taskId === dependsOnTaskId) throw new BadRequestException(INVALID_TASK_DEPENDENCY);

    // Load the entire reachable dependency graph starting from dependsOnTaskId
    // in a single query, then traverse in memory — avoids one DB round-trip per node.
    //
    // Strategy: iteratively expand the frontier, querying only the IDs we haven't
    // visited yet, so we converge to the full reachable set in at most O(depth) queries
    // instead of O(nodes) queries.
    const visited = new Set<string>();
    let frontier = [dependsOnTaskId];

    while (frontier.length > 0) {
      // Check for cycle before loading the next layer
      if (frontier.includes(taskId)) throw new BadRequestException(INVALID_TASK_DEPENDENCY);

      const unseen = frontier.filter((id) => !visited.has(id));
      if (!unseen.length) break;
      for (const id of unseen) visited.add(id);

      // Batch-load all outgoing edges for the current frontier in one query
      const edges = await manager.find(TaskDependency, {
        where: { taskId: In(unseen) },
        select: ['taskId', 'dependsOnTaskId'],
      });

      frontier = edges
        .map((e) => e.dependsOnTaskId)
        .filter((id) => !visited.has(id));
    }

    if (frontier.includes(taskId)) throw new BadRequestException(INVALID_TASK_DEPENDENCY);
  }

  // ── View metadata upsert ──────────────────────────────────────────────────

  async upsertViewMetadata(
    manager: EntityManager,
    task: Task,
    viewMeta?: CreateTaskDto['viewMeta'],
  ): Promise<void> {
    if (!viewMeta) return;

    const pairs: Array<{ viewType: ViewType; metaJson: Record<string, unknown> }> = [];
    if (viewMeta.mindmap) pairs.push({ viewType: ViewType.MINDMAP, metaJson: viewMeta.mindmap as Record<string, unknown> });
    if (viewMeta.gantt)   pairs.push({ viewType: ViewType.GANTT,   metaJson: viewMeta.gantt   as Record<string, unknown> });

    for (const pair of pairs) {
      const existing = await manager.findOne(TaskViewMetadata, {
        where: { taskId: task.id, viewType: pair.viewType },
      });
      if (existing) {
        existing.metaJson = pair.metaJson;
        await manager.save(existing);
      } else {
        await manager.save(
          manager.create(TaskViewMetadata, {
            task,
            taskId: task.id,
            viewType: pair.viewType,
            metaJson: pair.metaJson,
          }),
        );
      }
    }
  }

  // ── Dependency validation helper (bulk) ───────────────────────────────────

  async ensureDependencyTasks(projectId: string, taskIds: string[]): Promise<Task[]> {
    if (!taskIds.length) return [];

    const tasks = await this.taskRepo.find({
      where: { id: In(taskIds), projectId, deletedAt: IsNull() },
    });

    if (tasks.length !== new Set(taskIds).size) {
      throw new BadRequestException(INVALID_TASK_DEPENDENCY);
    }

    const indexed = new Map(tasks.map((t) => [t.id, t]));
    return taskIds.map((id) => indexed.get(id)!);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async listDependencies(taskId: string): Promise<TaskDependencyDetailSerializer[]> {
    const deps = await this.dependencyRepo.find({
      where: { taskId },
      relations: ['dependsOnTask'],
      order: { id: 'ASC' },
    });
    return deps.map((d) => this.serializeDependency(d));
  }

  async addDependency(
    task: Task,
    actorUser: User,
    dto: AddDependencyDto,
    projectId: string,
  ): Promise<TaskDependencyDetailSerializer> {
    const dependencyTask = await this.findTaskOrFail(dto.dependsOnTaskId, projectId);

    return this.dependencyRepo.manager.transaction(async (tx) => {
      const existing = await tx.findOne(TaskDependency, {
        where: { taskId: task.id, dependsOnTaskId: dto.dependsOnTaskId },
        relations: ['dependsOnTask'],
      });
      if (existing) return this.serializeDependency(existing);

      await this.ensureNoDependencyCycle(tx, task.id, dependencyTask.id);

      const dep = await tx.save(
        tx.create(TaskDependency, {
          task,
          taskId: task.id,
          dependsOnTask: dependencyTask,
          dependsOnTaskId: dependencyTask.id,
          dependencyType: dto.dependencyType ?? DependencyType.FINISH_TO_START,
          lagDays: dto.lagDays ?? null,
        }),
      );

      await this.activitySvc.log(tx, task, actorUser, TaskActionType.DEPENDENCY_ADDED, {
        dependencyId: dep.id,
        dependsOnTaskId: dep.dependsOnTaskId,
        operation: 'dependency_added',
      });

      return this.serializeDependency({ ...dep, dependsOnTask: dependencyTask });
    });
  }

  async deleteDependency(
    task: Task,
    depId: string,
    actorUser: User,
  ): Promise<{ id: string; success: true }> {
    const dep = await this.getDependencyOrFail(task.id, depId);

    await this.dependencyRepo.manager.transaction(async (tx) => {
      await tx.remove(dep);
      await this.activitySvc.log(tx, task, actorUser, TaskActionType.DEPENDENCY_REMOVED, {
        dependencyId: depId,
        dependsOnTaskId: dep.dependsOnTaskId,
      });
    });

    return { id: depId, success: true };
  }

  async listRelations(taskId: string): Promise<TaskRelationDetailSerializer[]> {
    const [outgoing, incoming] = await Promise.all([
      this.taskRelationRepo.find({ where: { taskId }, relations: ['relatedTask'], order: { createdAt: 'ASC' } }),
      this.taskRelationRepo.find({ where: { relatedTaskId: taskId }, relations: ['task'], order: { createdAt: 'ASC' } }),
    ]);

    const outgoingView = outgoing.map((r) => ({ ...r, direction: 'outgoing' as const }));
    const incomingView = incoming.map((r) => ({
      ...r,
      taskId: r.relatedTaskId,
      relatedTaskId: r.taskId,
      relatedTask: r.task,
      direction: 'incoming' as const,
    }));

    return [...outgoingView, ...incomingView].map((r) => this.serializeRelation(r));
  }

  async addRelation(
    task: Task,
    dto: AddRelationDto,
    projectId: string,
  ): Promise<TaskRelationDetailSerializer> {
    if (dto.relatedTaskId === task.id) throw new BadRequestException(TASK_RELATION_SELF);

    const relatedTask = await this.taskRepo.findOne({
      where: { id: dto.relatedTaskId, projectId, deletedAt: IsNull() },
    });
    if (!relatedTask) throw new BadRequestException(INVALID_TASK_RELATION);

    const existing = await this.taskRelationRepo.findOne({
      where: [
        { taskId: task.id, relatedTaskId: dto.relatedTaskId },
        { taskId: dto.relatedTaskId, relatedTaskId: task.id },
      ],
    });
    if (existing) throw new BadRequestException(INVALID_TASK_RELATION);

    const relation = await this.taskRelationRepo.save(
      this.taskRelationRepo.create({
        task,
        taskId: task.id,
        relatedTask,
        relatedTaskId: relatedTask.id,
        relationType: dto.relationType ?? RelationType.RELATES_TO,
      }),
    );

    return this.serializeRelation({ ...relation, relatedTask });
  }

  async deleteRelation(taskId: string, relationId: string): Promise<{ id: string; success: true }> {
    const relation = await this.getRelationOrFail(taskId, relationId);
    await this.taskRelationRepo.remove(relation);
    return { id: relationId, success: true };
  }
}
