import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OutboxService } from 'src/outbox/outbox.service';
import { plainToInstance } from 'class-transformer';
import {
  EntityManager,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  Repository,
} from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { FilterResponse } from 'src/common/interfaces';
import {
  Project,
  ProjectActivityLog,
  ProjectMembership,
} from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import type { ProjectPermissionAction } from 'src/projects/types/project-permission-matrix.type';
import { User } from 'src/users/entities';
import {
  AddChecklistItemDto,
  AddCommentDto,
  AddDependencyDto,
  AddLabelDto,
  AddRelationDto,
  AddWatcherDto,
  BulkUpdateTasksDto,
  CreateChecklistGroupDto,
  CreateTaskDto,
  MoveTaskDto,
  TaskFiltersDto,
  UpdateChecklistGroupDto,
  UpdateChecklistItemDto,
  UpdateCommentDto,
  UpdateTaskDto,
} from './dtos';
import {
  DependencyType,
  RelationType,
  Task,
  TaskActionType,
  TaskActivityLog,
  TaskAssignee,
  TaskChecklist,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskLabel,
  TaskRelation,
  TaskViewMetadata,
  TaskWatcher,
  ViewType,
} from './entities';
import {
  ProjectLabel,
  ProjectStatus,
  ProjectTaskType,
} from './project-config';
import {
  INVALID_TASK_ASSIGNEES,
  INVALID_TASK_ASSIGNED_MEMBERS,
  INVALID_TASK_DATE_RANGE,
  INVALID_TASK_DEPENDENCY,
  INVALID_TASK_HIERARCHY,
  INVALID_TASK_INCLUDE,
  INVALID_TASK_LABEL,
  INVALID_TASK_MOVE_TARGET,
  INVALID_TASK_PARENT,
  INVALID_TASK_RELATION,
  INVALID_TASK_REPORTEE,
  INVALID_TASK_WATCHER,
  TASK_CHECKLIST_GROUP_MISMATCH,
  TASK_CHECKLIST_GROUP_NOT_FOUND,
  TASK_CHECKLIST_ITEM_NOT_FOUND,
  TASK_COMMENT_ACCESS_DENIED,
  TASK_COMMENT_NOT_FOUND,
  TASK_DEPENDENCY_NOT_FOUND,
  TASK_LABEL_ALREADY_ADDED,
  TASK_LABEL_NOT_FOUND,
  TASK_NOT_FOUND,
  TASK_PROJECT_ACCESS_DENIED,
  TASK_PROJECT_NOT_FOUND,
  TASK_RELATION_NOT_FOUND,
  TASK_RELATION_SELF,
  TASK_STATUS_WIP_LIMIT_EXCEEDED,
  TASK_WATCHER_ALREADY_WATCHING,
  TASK_WATCHER_NOT_FOUND,
  TOO_MANY_TASK_INCLUDES,
} from './messages';
import {
  TaskChecklistGroupDetailSerializer,
  TaskChecklistItemDetailSerializer,
  TaskCommentDetailSerializer,
  TaskDependencyDetailSerializer,
  TaskLabelDetailSerializer,
  TaskListItemSerializer,
  TaskRelationDetailSerializer,
  TaskSerializer,
  TaskWatcherDetailSerializer,
} from './serializers';

interface TaskCounts {
  childCount: number;
  commentCount: number;
}

interface TaskScope {
  projectId: string;
  parentTaskId: string | null;
  statusId: string | null;
}

interface ProjectRoleContext {
  projectRoleId: string | null;
  projectRole: {
    id: string;
    name: string;
    slug: string;
    status: boolean;
    permissions: Record<string, boolean | Record<string, boolean>>;
  } | null;
}

const TASK_INCLUDE_KEYS = new Set([
  'assignedMembers',
  'reportee',
  'checklist',
  'dependencies',
  'comments',
  'viewMeta',
]);

const RANK_WIDTH = 10;
const RANK_BASE = 36n;
const RANK_STEP = 1024n;
const MAX_TASK_LIST_INCLUDES = 6;

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskAssignee)
    private readonly taskAssigneeRepo: Repository<TaskAssignee>,
    @InjectRepository(TaskChecklist)
    private readonly checklistGroupRepo: Repository<TaskChecklist>,
    @InjectRepository(TaskChecklistItem)
    private readonly checklistRepo: Repository<TaskChecklistItem>,
    @InjectRepository(TaskComment)
    private readonly commentRepo: Repository<TaskComment>,
    @InjectRepository(TaskDependency)
    private readonly dependencyRepo: Repository<TaskDependency>,
    @InjectRepository(TaskLabel)
    private readonly taskLabelRepo: Repository<TaskLabel>,
    @InjectRepository(TaskWatcher)
    private readonly taskWatcherRepo: Repository<TaskWatcher>,
    @InjectRepository(TaskRelation)
    private readonly taskRelationRepo: Repository<TaskRelation>,
    @InjectRepository(TaskViewMetadata)
    private readonly taskViewMetadataRepo: Repository<TaskViewMetadata>,
    @InjectRepository(TaskActivityLog)
    private readonly taskActivityLogRepo: Repository<TaskActivityLog>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
    @InjectRepository(ProjectActivityLog)
    private readonly projectActivityLogRepo: Repository<ProjectActivityLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ProjectStatus)
    private readonly projectStatusRepo: Repository<ProjectStatus>,
    @InjectRepository(ProjectTaskType)
    private readonly projectTaskTypeRepo: Repository<ProjectTaskType>,
    @InjectRepository(ProjectLabel)
    private readonly projectLabelRepo: Repository<ProjectLabel>,
    private readonly outboxService: OutboxService,
  ) {}

  private isAdmin(user: RequestUser): boolean {
    return false; // Workspace admin check is performed by WorkspaceGuard/ProjectPermissionGuard
  }

  private toTaskSerializer(
    task: Partial<Task> & Partial<TaskCounts>,
  ): TaskSerializer {
    return plainToInstance(TaskSerializer, task, {
      excludeExtraneousValues: true,
    });
  }

  private toTaskListItemSerializer(
    task: Partial<Task> & Partial<TaskCounts>,
  ): TaskListItemSerializer {
    return plainToInstance(TaskListItemSerializer, task, {
      excludeExtraneousValues: true,
    });
  }

  private toTaskChecklistItemSerializer(
    item: Partial<TaskChecklistItem>,
  ): TaskChecklistItemDetailSerializer {
    return plainToInstance(TaskChecklistItemDetailSerializer, item, {
      excludeExtraneousValues: true,
    });
  }

  private toTaskCommentSerializer(
    comment: Partial<TaskComment>,
  ): TaskCommentDetailSerializer {
    return plainToInstance(TaskCommentDetailSerializer, comment, {
      excludeExtraneousValues: true,
    });
  }

  private toTaskDependencySerializer(
    dependency: Partial<TaskDependency>,
  ): TaskDependencyDetailSerializer {
    return plainToInstance(TaskDependencyDetailSerializer, dependency, {
      excludeExtraneousValues: true,
    });
  }

  private toChecklistGroupSerializer(
    group: Partial<TaskChecklist>,
  ): TaskChecklistGroupDetailSerializer {
    return plainToInstance(TaskChecklistGroupDetailSerializer, group, {
      excludeExtraneousValues: true,
    });
  }

  private toTaskLabelSerializer(
    label: Partial<TaskLabel>,
  ): TaskLabelDetailSerializer {
    return plainToInstance(TaskLabelDetailSerializer, label, {
      excludeExtraneousValues: true,
    });
  }

  private toTaskWatcherSerializer(
    watcher: Partial<TaskWatcher>,
  ): TaskWatcherDetailSerializer {
    return plainToInstance(TaskWatcherDetailSerializer, watcher, {
      excludeExtraneousValues: true,
    });
  }

  private toTaskRelationSerializer(
    relation: Partial<TaskRelation>,
  ): TaskRelationDetailSerializer {
    return plainToInstance(TaskRelationDetailSerializer, relation, {
      excludeExtraneousValues: true,
    });
  }

  private parseIncludes(raw?: string): Set<string> {
    if (!raw) return new Set();

    const includes = new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );

    for (const include of includes) {
      if (!TASK_INCLUDE_KEYS.has(include)) {
        throw new BadRequestException(`${INVALID_TASK_INCLUDE}: ${include}`);
      }
    }

    if (includes.size > MAX_TASK_LIST_INCLUDES) {
      throw new BadRequestException(TOO_MANY_TASK_INCLUDES);
    }

    return includes;
  }

  private ensureDateRange(
    startDate?: string | null,
    endDate?: string | null,
  ): void {
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException(INVALID_TASK_DATE_RANGE);
    }
  }

  /**
   * Enforce the WIP limit of a status column.
   *
   * Pass `excludeTaskId` when the task is already in this status (update path) so
   * it is not counted twice.  On the create path omit it — the new task is not yet
   * persisted and should not be excluded.
   */
  private async assertWipLimit(
    tx: EntityManager,
    statusId: string,
    projectId: string,
    excludeTaskId?: string,
  ): Promise<void> {
    const status = await tx.findOne(ProjectStatus, {
      where: { id: statusId, projectId },
    });
    if (!status?.wipLimit) return; // no limit configured — nothing to check

    const qb = tx
      .createQueryBuilder(Task, 'task')
      .where('task.statusId = :statusId', { statusId })
      .andWhere('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL');

    if (excludeTaskId) {
      qb.andWhere('task.id != :excludeTaskId', { excludeTaskId });
    }

    const count = await qb.getCount();
    if (count >= status.wipLimit) {
      throw new BadRequestException(TASK_STATUS_WIP_LIMIT_EXCEEDED);
    }
  }

  private normalizeRequestedColumnOrder(
    requestedOrderIndex: number | undefined,
    siblingCount: number,
  ): number {
    if (requestedOrderIndex === undefined) return siblingCount;
    return Math.max(0, Math.min(requestedOrderIndex, siblingCount));
  }

  private normalizeRequestedChecklistOrder(
    requestedOrderIndex: number,
    siblingCount: number,
  ): number {
    return Math.max(0, Math.min(requestedOrderIndex, siblingCount));
  }

  private async reorderChecklistItems(
    manager: EntityManager,
    taskId: string,
    movingItemId: string | null,
    requestedOrderIndex?: number,
  ): Promise<void> {
    const items = await manager.find(TaskChecklistItem, {
      where: { taskId },
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });

    const movingItem = movingItemId
      ? (items.find((item) => item.id === movingItemId) ?? null)
      : null;
    const remaining = movingItem
      ? items.filter((item) => item.id !== movingItemId)
      : [...items];

    const targetIndex =
      requestedOrderIndex === undefined
        ? remaining.length
        : this.normalizeRequestedChecklistOrder(
            requestedOrderIndex,
            remaining.length,
          );

    if (movingItem) {
      remaining.splice(targetIndex, 0, movingItem);
    }

    for (const [index, item] of remaining.entries()) {
      if (item.orderIndex !== index) {
        item.orderIndex = index;
        await manager.save(item);
      }
    }
  }

  private async ensureParentTask(
    projectId: string,
    parentTaskId?: string | null,
  ): Promise<Task | null> {
    if (!parentTaskId) return null;

    const parent = await this.taskRepo.findOne({
      where: { id: parentTaskId, projectId, deletedAt: IsNull() },
    });

    if (!parent) throw new BadRequestException(INVALID_TASK_PARENT);
    return parent;
  }

  private async ensureAssigneeUsers(
    projectId: string,
    userIds: string[],
  ): Promise<User[]> {
    if (!userIds.length) return [];

    const memberships = await this.membershipRepo.find({
      where: {
        projectId,
        status: MembershipStatus.ACTIVE,
        userId: In(userIds),
      },
      relations: ['user'],
    });

    const uniqueUsers = new Map<string, User>();
    for (const membership of memberships) {
      if (membership.user) uniqueUsers.set(membership.userId, membership.user);
    }

    if (uniqueUsers.size !== new Set(userIds).size) {
      throw new BadRequestException(INVALID_TASK_ASSIGNEES);
    }

    return userIds.map((id) => uniqueUsers.get(id)!);
  }

  private async ensureAssignedMembers(
    projectId: string,
    assignedMembers: Array<{ userId: string; projectRoleId: string }>,
  ): Promise<ProjectMembership[]> {
    if (!assignedMembers.length) {
      throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);
    }

    const uniqueUserIds = [
      ...new Set(assignedMembers.map((member) => member.userId)),
    ];
    if (uniqueUserIds.length !== assignedMembers.length) {
      throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);
    }

    const memberships = await this.membershipRepo.find({
      where: {
        projectId,
        status: MembershipStatus.ACTIVE,
        userId: In(uniqueUserIds),
      },
      relations: ['user', 'projectRole'],
    });

    if (memberships.length !== uniqueUserIds.length) {
      throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);
    }

    const membershipMap = new Map(
      memberships.map((membership) => [membership.userId, membership]),
    );

    for (const member of assignedMembers) {
      const membership = membershipMap.get(member.userId);
      if (!membership || membership.projectRoleId !== member.projectRoleId) {
        throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);
      }
    }

    return assignedMembers.map((member) => membershipMap.get(member.userId)!);
  }

  private async ensureReporteeMember(
    projectId: string,
    reportee: { userId: string; projectRoleId: string },
  ): Promise<ProjectMembership> {
    const membership = await this.membershipRepo.findOne({
      where: {
        projectId,
        userId: reportee.userId,
        status: MembershipStatus.ACTIVE,
      },
      relations: ['user', 'projectRole'],
    });

    if (!membership || membership.projectRoleId !== reportee.projectRoleId) {
      throw new BadRequestException(INVALID_TASK_REPORTEE);
    }

    return membership;
  }

  private async loadProjectRoleContextMap(
    projectId: string,
    userIds: string[],
  ): Promise<Map<string, ProjectRoleContext>> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (!uniqueIds.length) return new Map();

    const memberships = await this.membershipRepo.find({
      where: {
        projectId,
        status: MembershipStatus.ACTIVE,
        userId: In(uniqueIds),
      },
      relations: ['projectRole'],
    });

    return new Map(
      memberships.map((membership) => [
        membership.userId,
        {
          projectRoleId: membership.projectRoleId ?? null,
          projectRole: membership.projectRole
            ? {
                id: membership.projectRole.id,
                name: membership.projectRole.name,
                slug: membership.projectRole.slug,
                status: membership.projectRole.status,
                permissions: membership.projectRole.permissions,
              }
            : null,
        },
      ]),
    );
  }

  private buildTaskReadModel(
    task: Task,
    membershipRoleContext: Map<string, ProjectRoleContext>,
    counts?: Partial<TaskCounts>,
  ): Partial<Task> & Partial<TaskCounts> & Record<string, unknown> {
    const assignedMembers = (task.assignees ?? []).map((assignee) => {
      const roleContext = membershipRoleContext.get(assignee.userId);

      return {
        userId: assignee.userId,
        firstName: assignee.user?.firstName ?? null,
        lastName: assignee.user?.lastName ?? null,
        email: assignee.user?.email ?? null,
        title: assignee.user?.title ?? null,
        projectRoleId: roleContext?.projectRoleId ?? null,
        projectRole: roleContext?.projectRole ?? null,
        assignmentRole: assignee.assignmentRole ?? null,
      };
    });

    const reporteeUser = task.reporteeUser ?? null;
    const reporteeRoleContext = reporteeUser
      ? membershipRoleContext.get(reporteeUser.id)
      : undefined;

    return {
      ...task,
      assignedMembers,
      reportee: reporteeUser
        ? {
            userId: reporteeUser.id,
            firstName: reporteeUser.firstName ?? null,
            lastName: reporteeUser.lastName ?? null,
            email: reporteeUser.email ?? null,
            title: reporteeUser.title ?? null,
            projectRoleId: reporteeRoleContext?.projectRoleId ?? null,
            projectRole: reporteeRoleContext?.projectRole ?? null,
          }
        : null,
      dependencies: task.dependencyEdges ?? [],
      childCount: counts?.childCount ?? 0,
      commentCount: counts?.commentCount ?? 0,
    };
  }

  private async ensureDependencyTasks(
    projectId: string,
    taskIds: string[],
  ): Promise<Task[]> {
    if (!taskIds.length) return [];

    const tasks = await this.taskRepo.find({
      where: {
        id: In(taskIds),
        projectId,
        deletedAt: IsNull(),
      },
    });

    if (tasks.length !== new Set(taskIds).size) {
      throw new BadRequestException(INVALID_TASK_DEPENDENCY);
    }

    const indexed = new Map(tasks.map((task) => [task.id, task]));
    return taskIds.map((id) => indexed.get(id)!);
  }

  private async computeCounts(taskId: string): Promise<TaskCounts> {
    const [childCount, commentCount] = await Promise.all([
      this.taskRepo.count({
        where: { parentTaskId: taskId, deletedAt: IsNull() },
      }),
      this.commentRepo.count({
        where: { taskId, deletedAt: IsNull() },
      }),
    ]);

    return { childCount, commentCount };
  }

  private parseRankValue(rank?: string | null): bigint | null {
    if (!rank || !/^[0-9a-z]+$/i.test(rank)) return null;

    let result = 0n;
    for (const char of rank.toLowerCase()) {
      result = result * RANK_BASE + BigInt(parseInt(char, 36));
    }

    return result;
  }

  private formatRankValue(value: bigint): string {
    if (value < 0n) return '0'.repeat(RANK_WIDTH);
    return value.toString(36).padStart(RANK_WIDTH, '0').slice(-RANK_WIDTH);
  }

  private buildTaskScope(
    projectId: string,
    parentTaskId: string | null,
    statusId: string | null,
  ): TaskScope {
    return { projectId, parentTaskId, statusId };
  }

  private scopeWhere(scope: TaskScope): FindOptionsWhere<Task> {
    return {
      projectId: scope.projectId,
      deletedAt: IsNull(),
      parentTaskId: scope.parentTaskId ?? IsNull(),
      statusId: scope.statusId ?? IsNull(),
    };
  }

  private async getScopedTasks(
    manager: EntityManager,
    scope: TaskScope,
    excludeTaskId?: string,
  ): Promise<Task[]> {
    const tasks = await manager.find(Task, {
      where: this.scopeWhere(scope),
      order: { rank: 'ASC', createdAt: 'ASC' },
    });

    return excludeTaskId
      ? tasks.filter((task) => task.id !== excludeTaskId)
      : tasks;
  }

  private async rebalanceScopeRanks(
    manager: EntityManager,
    scope: TaskScope,
    excludeTaskId?: string,
  ): Promise<Map<string, string>> {
    const tasks = await this.getScopedTasks(manager, scope, excludeTaskId);
    const rankMap = new Map<string, string>();

    let current = RANK_STEP;
    for (const sibling of tasks) {
      const nextRank = this.formatRankValue(current);
      if (sibling.rank !== nextRank) {
        sibling.rank = nextRank;
        await manager.save(sibling);
      }
      rankMap.set(sibling.id, nextRank);
      current += RANK_STEP;
    }

    return rankMap;
  }

  private async calculateRankWithinScope(
    manager: EntityManager,
    scope: TaskScope,
    beforeTaskId?: string,
    afterTaskId?: string,
    excludeTaskId?: string,
  ): Promise<string> {
    const siblings = await this.getScopedTasks(manager, scope, excludeTaskId);
    const siblingIds = new Set(siblings.map((sibling) => sibling.id));

    if (beforeTaskId && !siblingIds.has(beforeTaskId)) {
      throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
    }
    if (afterTaskId && !siblingIds.has(afterTaskId)) {
      throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
    }
    if (beforeTaskId && afterTaskId && beforeTaskId === afterTaskId) {
      throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
    }
    if (beforeTaskId && afterTaskId) {
      const beforeIndex = siblings.findIndex(
        (sibling) => sibling.id === beforeTaskId,
      );
      const afterIndex = siblings.findIndex(
        (sibling) => sibling.id === afterTaskId,
      );
      if (
        beforeIndex === -1 ||
        afterIndex === -1 ||
        afterIndex + 1 !== beforeIndex
      ) {
        throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
      }
    }

    const beforeRank = this.parseRankValue(
      beforeTaskId
        ? siblings.find((sibling) => sibling.id === beforeTaskId)?.rank
        : null,
    );
    const afterRank = this.parseRankValue(
      afterTaskId
        ? siblings.find((sibling) => sibling.id === afterTaskId)?.rank
        : null,
    );

    if (beforeRank !== null && afterRank !== null) {
      if (beforeRank - afterRank > 1n) {
        return this.formatRankValue((beforeRank + afterRank) / 2n);
      }
      await this.rebalanceScopeRanks(manager, scope, excludeTaskId);
      return this.calculateRankWithinScope(
        manager,
        scope,
        beforeTaskId,
        afterTaskId,
        excludeTaskId,
      );
    }

    if (beforeRank !== null) {
      if (beforeRank > 1n) {
        return this.formatRankValue(beforeRank / 2n);
      }
      await this.rebalanceScopeRanks(manager, scope, excludeTaskId);
      return this.calculateRankWithinScope(
        manager,
        scope,
        beforeTaskId,
        afterTaskId,
        excludeTaskId,
      );
    }

    if (afterRank !== null) {
      return this.formatRankValue(afterRank + RANK_STEP);
    }

    const lastSibling = siblings[siblings.length - 1];
    if (!lastSibling) {
      return this.formatRankValue(RANK_STEP);
    }

    const lastRank = this.parseRankValue(lastSibling.rank) ?? 0n;
    return this.formatRankValue(lastRank + RANK_STEP);
  }

  private async assertNotDescendant(
    projectId: string,
    taskId: string,
    targetParentTaskId: string | null,
  ): Promise<void> {
    if (!targetParentTaskId) return;
    if (targetParentTaskId === taskId) {
      throw new BadRequestException(INVALID_TASK_HIERARCHY);
    }

    const tasks = await this.taskRepo.find({
      where: { projectId, deletedAt: IsNull() },
      select: ['id', 'parentTaskId'],
    });

    const queue = [taskId];
    const descendants = new Set<string>([taskId]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const candidate of tasks) {
        if (
          candidate.parentTaskId === currentId &&
          !descendants.has(candidate.id)
        ) {
          descendants.add(candidate.id);
          queue.push(candidate.id);
        }
      }
    }

    if (descendants.has(targetParentTaskId)) {
      throw new BadRequestException(INVALID_TASK_HIERARCHY);
    }
  }

  private async getNextRank(
    manager: EntityManager,
    projectId: string,
    parentTaskId?: string | null,
    statusId?: string | null,
  ): Promise<string> {
    return this.calculateRankWithinScope(
      manager,
      this.buildTaskScope(
        projectId,
        parentTaskId ?? null,
        statusId ?? null,
      ),
    );
  }

  private async ensureNoDependencyCycle(
    manager: EntityManager,
    taskId: string,
    dependsOnTaskId: string,
  ): Promise<void> {
    if (taskId === dependsOnTaskId) {
      throw new BadRequestException(INVALID_TASK_DEPENDENCY);
    }

    const visited = new Set<string>();
    const queue = [dependsOnTaskId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === taskId) {
        throw new BadRequestException(INVALID_TASK_DEPENDENCY);
      }
      if (visited.has(current)) continue;
      visited.add(current);

      const outgoing = await manager.find(TaskDependency, {
        where: { taskId: current },
      });

      for (const edge of outgoing) {
        if (!visited.has(edge.dependsOnTaskId)) {
          queue.push(edge.dependsOnTaskId);
        }
      }
    }
  }

  private async upsertViewMetadata(
    manager: EntityManager,
    task: Task,
    viewMeta?: CreateTaskDto['viewMeta'],
  ): Promise<void> {
    if (!viewMeta) return;

    const pairs: Array<{
      viewType: ViewType;
      metaJson: Record<string, unknown>;
    }> = [];
    if (viewMeta.mindmap) {
      pairs.push({
        viewType: ViewType.MINDMAP,
        metaJson: viewMeta.mindmap as Record<string, unknown>,
      });
    }
    if (viewMeta.gantt) {
      pairs.push({
        viewType: ViewType.GANTT,
        metaJson: viewMeta.gantt as Record<string, unknown>,
      });
    }

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

  private async loadTaskOrFail(
    taskId: string,
    projectId: string,
  ): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
      relations: [
        'assignees',
        'assignees.user',
        'checklistItems',
        'comments',
        'dependencyEdges',
        'viewMetadataEntries',
        'reporteeUser',
        'status',
        'priority',
        'taskType',
        'severity',
      ],
    });

    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    return task;
  }

  private async loadTasksForList(
    taskIds: string[],
    projectId: string,
  ): Promise<TaskListItemSerializer[]> {
    if (!taskIds.length) return [];

    const tasks = await this.taskRepo.find({
      where: {
        id: In(taskIds),
        projectId,
        deletedAt: IsNull(),
      },
      relations: [
        'assignees',
        'assignees.user',
        'checklistItems',
        'comments',
        'dependencyEdges',
        'viewMetadataEntries',
        'reporteeUser',
        'status',
        'priority',
        'taskType',
        'severity',
      ],
      order: { createdAt: 'DESC' },
    });

    const counts = await Promise.all(
      tasks.map(async (task) => ({
        taskId: task.id,
        ...(await this.computeCounts(task.id)),
      })),
    );
    const countMap = new Map(counts.map((entry) => [entry.taskId, entry]));
    const membershipRoleContext = await this.loadProjectRoleContextMap(
      projectId,
      tasks.flatMap((task) =>
        [
          task.reporteeUserId,
          ...(task.assignees ?? []).map((assignee) => assignee.userId),
        ].filter((value): value is string => Boolean(value)),
      ),
    );

    return tasks.map((task) =>
      this.toTaskListItemSerializer(
        this.buildTaskReadModel(task, membershipRoleContext, {
          childCount: countMap.get(task.id)?.childCount ?? 0,
          commentCount: countMap.get(task.id)?.commentCount ?? 0,
        }),
      ),
    );
  }

  private async ensureTaskForSubresource(
    projectId: string,
    taskId: string,
  ): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
      relations: ['project'],
    });

    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    return task;
  }

  private async getCommentOrFail(
    taskId: string,
    commentId: string,
  ): Promise<TaskComment> {
    const comment = await this.commentRepo.findOne({
      where: { id: commentId, taskId, deletedAt: IsNull() },
    });

    if (!comment) throw new NotFoundException(TASK_COMMENT_NOT_FOUND);
    return comment;
  }

  private async getChecklistItemOrFail(
    taskId: string,
    itemId: string,
  ): Promise<TaskChecklistItem> {
    const item = await this.checklistRepo.findOne({
      where: { id: itemId, taskId },
    });

    if (!item) throw new NotFoundException(TASK_CHECKLIST_ITEM_NOT_FOUND);
    return item;
  }

  private async getDependencyOrFail(
    taskId: string,
    depId: string,
  ): Promise<TaskDependency> {
    const dependency = await this.dependencyRepo.findOne({
      where: { id: depId, taskId },
    });

    if (!dependency) throw new NotFoundException(TASK_DEPENDENCY_NOT_FOUND);
    return dependency;
  }

  private async getChecklistGroupOrFail(
    taskId: string,
    groupId: string,
  ): Promise<TaskChecklist> {
    const group = await this.checklistGroupRepo.findOne({
      where: { id: groupId },
      relations: ['items'],
    });
    if (!group) throw new NotFoundException(TASK_CHECKLIST_GROUP_NOT_FOUND);
    if (group.taskId !== taskId) throw new BadRequestException(TASK_CHECKLIST_GROUP_MISMATCH);
    return group;
  }

  private async getTaskLabelOrFail(
    taskId: string,
    labelId: string,
  ): Promise<TaskLabel> {
    const tl = await this.taskLabelRepo.findOne({
      where: { id: labelId, taskId },
      relations: ['label'],
    });
    if (!tl) throw new NotFoundException(TASK_LABEL_NOT_FOUND);
    return tl;
  }

  private async getTaskWatcherOrFail(
    taskId: string,
    watcherId: string,
  ): Promise<TaskWatcher> {
    const w = await this.taskWatcherRepo.findOne({
      where: { id: watcherId, taskId },
      relations: ['user'],
    });
    if (!w) throw new NotFoundException(TASK_WATCHER_NOT_FOUND);
    return w;
  }

  private async getTaskRelationOrFail(
    taskId: string,
    relationId: string,
  ): Promise<TaskRelation> {
    const r = await this.taskRelationRepo.findOne({
      where: { id: relationId, taskId },
      relations: ['relatedTask'],
    });
    if (!r) throw new NotFoundException(TASK_RELATION_NOT_FOUND);
    return r;
  }

  /**
   * Map TaskActionType → dot-separated outbox event type string.
   * Outbox consumers receive this as `eventType` in their job payload.
   */
  private static taskActionToEventType(action: TaskActionType): string {
    const map: Record<TaskActionType, string> = {
      [TaskActionType.TASK_CREATED]: 'task.created',
      [TaskActionType.TASK_UPDATED]: 'task.updated',
      [TaskActionType.TASK_MOVED]: 'task.moved',
      [TaskActionType.TASK_DELETED]: 'task.deleted',
      [TaskActionType.TASK_ASSIGNED]: 'task.assigned',
      [TaskActionType.TASK_UNASSIGNED]: 'task.unassigned',
      [TaskActionType.COMMENT_ADDED]: 'task.comment.added',
      [TaskActionType.STATUS_CHANGED]: 'task.status.changed',
      [TaskActionType.CHECKLIST_UPDATED]: 'task.checklist.updated',
      [TaskActionType.DEPENDENCY_ADDED]: 'task.dependency.added',
      [TaskActionType.DEPENDENCY_REMOVED]: 'task.dependency.removed',
    };
    return map[action] ?? `task.${action.toLowerCase()}`;
  }

  private async logTaskActivity(
    manager: EntityManager,
    task: Pick<Task, 'id' | 'projectId' | 'project'>,
    actorUser: User,
    actionType: TaskActionType,
    actionMeta?: Record<string, unknown> | null,
  ): Promise<void> {
    await manager.save(
      manager.create(TaskActivityLog, {
        taskId: task.id,
        projectId: task.projectId,
        actorUser,
        actorUserId: actorUser.id,
        actionType,
        actionMeta: actionMeta ?? {},
      }),
    );

    await manager.save(
      manager.create(ProjectActivityLog, {
        project: task.project,
        projectId: task.projectId,
        user: actorUser,
        userId: actorUser.id,
        taskId: task.id,
        actionType,
        actionMeta: actionMeta ?? {},
      }),
    );

    // Write outbox event in the same transaction so it is never lost.
    await this.outboxService.record(manager, {
      aggregateType: 'task',
      aggregateId: task.id,
      eventType: TasksService.taskActionToEventType(actionType),
      payload: {
        taskId: task.id,
        projectId: task.projectId,
        actorUserId: actorUser.id,
        ...(actionMeta ?? {}),
      },
    });
  }

  private membershipHasTaskPermission(
    membership: ProjectMembership | null | undefined,
    action: ProjectPermissionAction,
  ): boolean {
    return (
      membership?.status === MembershipStatus.ACTIVE &&
      membership.projectRole?.status === true &&
      membership.projectRole.permissions?.taskManagement?.[action] === true
    );
  }

  async verifyProjectPermission(
    projectId: string,
    requestUser: RequestUser,
    action: ProjectPermissionAction,
  ): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException(TASK_PROJECT_NOT_FOUND);
    }

    if (this.isAdmin(requestUser)) {
      return project;
    }

    const membership = await this.membershipRepo.findOne({
      where: {
        projectId,
        userId: requestUser.id,
        status: MembershipStatus.ACTIVE,
      },
      relations: ['projectRole'],
    });

    if (!this.membershipHasTaskPermission(membership, action)) {
      throw new ForbiddenException(TASK_PROJECT_ACCESS_DENIED);
    }

    return project;
  }

  async createTask(
    projectId: string,
    dto: CreateTaskDto,
    requestUser: RequestUser,
  ): Promise<TaskSerializer> {
    const project = await this.verifyProjectPermission(
      projectId,
      requestUser,
      'create',
    );

    const [
      parent,
      assignedMemberships,
      reporteeMembership,
      dependencyTasks,
      actorUser,
    ] = await Promise.all([
      this.ensureParentTask(projectId, dto.parentTaskId),
      dto.assignedMembers !== undefined
        ? this.ensureAssignedMembers(projectId, dto.assignedMembers)
        : Promise.resolve([]),
      dto.reportee !== undefined
        ? this.ensureReporteeMember(projectId, dto.reportee)
        : Promise.resolve(null),
      this.ensureDependencyTasks(projectId, dto.dependencyIds ?? []),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    this.ensureDateRange(dto.startDate, dto.endDate);

    // Resolve default status and task type for the project
    const [defaultStatus, defaultTaskType] = await Promise.all([
      dto.statusId
        ? this.projectStatusRepo.findOne({ where: { id: dto.statusId, projectId } })
        : this.projectStatusRepo.findOne({ where: { projectId, isDefault: true } }),
      dto.taskTypeId
        ? this.projectTaskTypeRepo.findOne({ where: { id: dto.taskTypeId, projectId } })
        : this.projectTaskTypeRepo.findOne({ where: { projectId, isDefault: true } }),
    ]);

    if (!defaultStatus) {
      throw new BadRequestException('Project has no default status. Provide statusId.');
    }
    if (!defaultTaskType) {
      throw new BadRequestException('Project has no default task type. Provide taskTypeId.');
    }

    // Auto-complete: tasks in a 'done' terminal status are marked completed
    const isCompleted = defaultStatus.isTerminal;

    const savedTask = await this.taskRepo.manager.transaction(async (tx) => {
      await this.assertWipLimit(tx, defaultStatus.id, projectId);

      const rank = await this.getNextRank(
        tx,
        projectId,
        parent?.id ?? null,
        defaultStatus.id,
      );

      const task = tx.create(Task, {
        project,
        projectId,
        parent: parent ?? null,
        parentTaskId: parent?.id ?? null,
        statusId: defaultStatus.id,
        priorityId: dto.priorityId ?? null,
        taskTypeId: defaultTaskType.id,
        severityId: dto.severityId ?? null,
        createdByUser: actorUser,
        createdByUserId: actorUser.id,
        reporteeUser: reporteeMembership?.user ?? null,
        reporteeUserId: reporteeMembership?.userId ?? null,
        title: dto.title.trim(),
        description: dto.description ?? null,
        startDate: dto.startDate ?? null,
        endDate: dto.endDate ?? null,
        progress: dto.progress ?? null,
        completed: isCompleted,
        rank,
        deletedAt: null,
      });

      const saved = await tx.save(task);

      if (assignedMemberships.length) {
        await tx.save(
          assignedMemberships.map((membership) =>
            tx.create(TaskAssignee, {
              task: saved,
              taskId: saved.id,
              user: membership.user,
              userId: membership.userId,
            }),
          ),
        );
      }

      if (dto.checklistItems?.length) {
        await tx.save(
          dto.checklistItems.map((item) =>
            tx.create(TaskChecklistItem, {
              task: saved,
              taskId: saved.id,
              text: item.text.trim(),
              orderIndex: item.orderIndex,
            }),
          ),
        );
      }

      for (const dependencyTask of dependencyTasks) {
        await tx.save(
          tx.create(TaskDependency, {
            task: saved,
            taskId: saved.id,
            dependsOnTask: dependencyTask,
            dependsOnTaskId: dependencyTask.id,
          }),
        );
      }

      await this.upsertViewMetadata(tx, saved, dto.viewMeta);
      await this.logTaskActivity(
        tx,
        { ...saved, project },
        actorUser,
        TaskActionType.TASK_CREATED,
        {
          title: saved.title,
        },
      );

      return saved;
    });

    return this.getTask(projectId, savedTask.id, requestUser);
  }

  async updateTask(
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
    requestUser: RequestUser,
  ): Promise<TaskSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
      relations: [
        'project',
        'assignees',
        'dependencyEdges',
        'viewMetadataEntries',
        'reporteeUser',
      ],
    });
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    const [
      assignedMemberships,
      reporteeMembership,
      dependencyTasks,
      actorUser,
    ] = await Promise.all([
      dto.assignedMembers !== undefined
        ? this.ensureAssignedMembers(projectId, dto.assignedMembers)
        : Promise.resolve(undefined),
      dto.reportee !== undefined
        ? this.ensureReporteeMember(projectId, dto.reportee)
        : Promise.resolve(undefined),
      dto.dependencyIds !== undefined
        ? this.ensureDependencyTasks(projectId, dto.dependencyIds)
        : Promise.resolve(undefined),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    const nextStartDate =
      dto.startDate !== undefined ? (dto.startDate ?? null) : task.startDate;
    const nextEndDate =
      dto.endDate !== undefined ? (dto.endDate ?? null) : task.endDate;
    this.ensureDateRange(nextStartDate, nextEndDate);

    const originalStatusId = task.statusId;
    const changedFields: string[] = [];

    if (dto.title !== undefined) {
      task.title = dto.title.trim();
      changedFields.push('title');
    }
    if (dto.description !== undefined) {
      task.description = dto.description ?? null;
      changedFields.push('description');
    }
    if (dto.statusId !== undefined) {
      task.statusId = dto.statusId ?? task.statusId;
      changedFields.push('statusId');
      // Auto-complete: if new status is terminal, mark task completed
      if (dto.statusId) {
        const newStatus = await this.projectStatusRepo.findOne({
          where: { id: dto.statusId, projectId },
        });
        if (newStatus) task.completed = newStatus.isTerminal;
      }
    }
    if (dto.priorityId !== undefined) {
      task.priorityId = dto.priorityId ?? null;
      changedFields.push('priorityId');
    }
    if (dto.taskTypeId !== undefined) {
      task.taskTypeId = dto.taskTypeId;
      changedFields.push('taskTypeId');
    }
    if (dto.severityId !== undefined) {
      task.severityId = dto.severityId ?? null;
      changedFields.push('severityId');
    }
    if (dto.startDate !== undefined) {
      task.startDate = dto.startDate ?? null;
      changedFields.push('startDate');
    }
    if (dto.endDate !== undefined) {
      task.endDate = dto.endDate ?? null;
      changedFields.push('endDate');
    }
    if (dto.progress !== undefined) {
      task.progress = dto.progress ?? null;
      changedFields.push('progress');
    }
    if (dto.reportee !== undefined) {
      task.reporteeUser = reporteeMembership!.user;
      task.reporteeUserId = reporteeMembership!.userId;
      changedFields.push('reportee');
    }

    await this.taskRepo.manager.transaction(async (tx) => {
      // Enforce WIP limit when moving task to a different status column
      if (dto.statusId && task.statusId !== originalStatusId) {
        await this.assertWipLimit(tx, task.statusId, projectId);
      }

      await tx.save(task);

      if (dto.assignedMembers !== undefined) {
        const currentAssignees = await tx.find(TaskAssignee, {
          where: { taskId: task.id },
        });
        const currentIds = new Set(
          currentAssignees.map((assignee) => assignee.userId),
        );
        const desiredIds = new Set(
          dto.assignedMembers.map((member) => member.userId),
        );

        const toRemove = currentAssignees
          .filter((assignee) => !desiredIds.has(assignee.userId))
          .map((assignee) => assignee.id);
        const toAdd = (assignedMemberships ?? []).filter(
          (membership) => !currentIds.has(membership.userId),
        );

        if (toRemove.length) {
          await tx.delete(TaskAssignee, { id: In(toRemove) });
        }
        if (toAdd.length) {
          await tx.save(
            toAdd.map((membership) =>
              tx.create(TaskAssignee, {
                task,
                taskId: task.id,
                user: membership.user,
                userId: membership.userId,
              }),
            ),
          );
        }

        changedFields.push('assignedMembers');
      }

      if (dto.checklistItems !== undefined) {
        await tx.delete(TaskChecklistItem, { taskId: task.id });
        if (dto.checklistItems.length) {
          await tx.save(
            dto.checklistItems.map((item) =>
              tx.create(TaskChecklistItem, {
                task,
                taskId: task.id,
                text: item.text.trim(),
                orderIndex: item.orderIndex,
              }),
            ),
          );
        }
        changedFields.push('checklistItems');
      }

      if (dto.dependencyIds !== undefined) {
        const existingDeps = await tx.find(TaskDependency, {
          where: { taskId: task.id },
        });
        const existingMap = new Map(
          existingDeps.map((dep) => [dep.dependsOnTaskId, dep]),
        );
        const desiredIds = new Set(dto.dependencyIds);

        const toRemove = existingDeps
          .filter((dep) => !desiredIds.has(dep.dependsOnTaskId))
          .map((dep) => dep.id);

        if (toRemove.length) {
          await tx.delete(TaskDependency, { id: In(toRemove) });
        }

        for (const dependencyTask of dependencyTasks ?? []) {
          if (existingMap.has(dependencyTask.id)) continue;
          await this.ensureNoDependencyCycle(tx, task.id, dependencyTask.id);
          await tx.save(
            tx.create(TaskDependency, {
              task,
              taskId: task.id,
              dependsOnTask: dependencyTask,
              dependsOnTaskId: dependencyTask.id,
            }),
          );
        }

        changedFields.push('dependencyIds');
      }

      if (dto.viewMeta !== undefined) {
        await this.upsertViewMetadata(tx, task, dto.viewMeta);
        changedFields.push('viewMeta');
      }

      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          changedFields,
        },
      );
    });

    return this.getTask(projectId, task.id, requestUser);
  }

  async moveTask(
    projectId: string,
    taskId: string,
    dto: MoveTaskDto,
    requestUser: RequestUser,
  ): Promise<TaskSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const [task, actorUser] = await Promise.all([
      this.taskRepo.findOne({
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['project'],
      }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    const sourceScope = this.buildTaskScope(
      projectId,
      task.parentTaskId,
      task.statusId,
    );

    const nextParentTaskId =
      dto.parentTaskId !== undefined
        ? (dto.parentTaskId ?? null)
        : task.parentTaskId;
    // statusId is now always non-null; if dto.statusId is null or undefined, keep current
    const nextStatusId: string =
      dto.statusId != null ? dto.statusId : task.statusId;

    await this.assertNotDescendant(projectId, task.id, nextParentTaskId);

    const parent = await this.ensureParentTask(projectId, nextParentTaskId);

    await this.taskRepo.manager.transaction(async (tx) => {
      const destinationScope = this.buildTaskScope(
        projectId,
        parent?.id ?? null,
        nextStatusId,
      );

      const nextRank = await this.calculateRankWithinScope(
        tx,
        destinationScope,
        dto.beforeTaskId,
        dto.afterTaskId,
        task.id,
      );

      task.parent = parent ?? null;
      task.parentTaskId = parent?.id ?? null;
      task.statusId = nextStatusId;
      task.rank = nextRank;

      await tx.save(task);
      await this.rebalanceScopeRanks(tx, destinationScope);

      if (
        sourceScope.parentTaskId !== destinationScope.parentTaskId ||
        sourceScope.statusId !== destinationScope.statusId
      ) {
        await this.rebalanceScopeRanks(tx, sourceScope);
      }

      const refreshedTask = await tx.findOne(Task, {
        where: { id: task.id },
      });
      if (refreshedTask?.rank) {
        task.rank = refreshedTask.rank;
      }

      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_MOVED,
        {
          parentTaskId: task.parentTaskId,
          statusId: task.statusId,
          rank: task.rank,
        },
      );
    });

    return this.getTask(projectId, task.id, requestUser);
  }

  async bulkUpdateTasks(
    projectId: string,
    dto: BulkUpdateTasksDto,
    requestUser: RequestUser,
  ): Promise<TaskListItemSerializer[]> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const actorUser = await this.userRepo.findOneOrFail({
      where: { id: requestUser.id },
    });
    const requestedIds = [...new Set(dto.items.map((item) => item.taskId))];
    const tasks = await this.taskRepo.find({
      where: {
        id: In(requestedIds),
        projectId,
        deletedAt: IsNull(),
      },
      relations: ['project'],
    });

    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const updatedTaskIds: string[] = [];

    await this.taskRepo.manager.transaction(async (tx) => {
      for (const item of dto.items) {
        const task = taskMap.get(item.taskId);
        if (!task) continue;

        const nextStartDate =
          item.startDate !== undefined
            ? (item.startDate ?? null)
            : task.startDate;
        const nextEndDate =
          item.endDate !== undefined ? (item.endDate ?? null) : task.endDate;
        this.ensureDateRange(nextStartDate, nextEndDate);

        const nextParentTaskId =
          item.parentTaskId !== undefined
            ? (item.parentTaskId ?? null)
            : task.parentTaskId;
        const nextStatusId =
          item.statusId !== undefined
            ? (item.statusId ?? null)
            : task.statusId;

        if (item.parentTaskId !== undefined) {
          await this.assertNotDescendant(projectId, task.id, nextParentTaskId);
        }

        const parent =
          item.parentTaskId !== undefined
            ? await this.ensureParentTask(projectId, nextParentTaskId)
            : undefined;

        let movedScope = false;
        if (item.statusId !== undefined) {
          const prevStatusId = task.statusId;
          task.statusId = nextStatusId ?? task.statusId;
          // Enforce WIP limit when the status column actually changes
          if (item.statusId && task.statusId !== prevStatusId) {
            await this.assertWipLimit(tx, task.statusId, projectId);
          }
        }
        if (item.priorityId !== undefined) {
          task.priorityId = item.priorityId ?? null;
        }
        if (item.taskTypeId !== undefined) {
          task.taskTypeId = item.taskTypeId;
        }
        if (item.severityId !== undefined) {
          task.severityId = item.severityId ?? null;
        }
        if (item.progress !== undefined) {
          task.progress = item.progress;
        }
        if (item.startDate !== undefined) {
          task.startDate = item.startDate ?? null;
        }
        if (item.endDate !== undefined) {
          task.endDate = item.endDate ?? null;
        }
        if (item.parentTaskId !== undefined) {
          task.parent = parent ?? null;
          task.parentTaskId = parent?.id ?? null;
          movedScope = true;
        }
        if (item.statusId !== undefined) {
          movedScope = true;
        }
        if (movedScope) {
          task.rank = await this.calculateRankWithinScope(
            tx,
            this.buildTaskScope(
              projectId,
              task.parentTaskId,
              task.statusId,
            ),
            undefined,
            undefined,
            task.id,
          );
        }

        await tx.save(task);
        if (item.viewMeta !== undefined) {
          await this.upsertViewMetadata(tx, task, item.viewMeta);
        }
        await this.logTaskActivity(
          tx,
          task,
          actorUser,
          movedScope ? TaskActionType.TASK_MOVED : TaskActionType.TASK_UPDATED,
          {
            statusId: task.statusId,
            progress: item.progress,
            startDate: item.startDate,
            endDate: item.endDate,
            parentTaskId: task.parentTaskId,
            viewMetaUpdated: item.viewMeta !== undefined,
          },
        );
        updatedTaskIds.push(task.id);
      }
    });

    return this.loadTasksForList(updatedTaskIds, projectId);
  }

  async getTaskComments(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskCommentDetailSerializer[]> {
    await this.verifyProjectPermission(projectId, requestUser, 'view');
    await this.ensureTaskForSubresource(projectId, taskId);

    const comments = await this.commentRepo.find({
      where: { taskId, deletedAt: IsNull() },
      relations: ['authorUser'],
      order: { createdAt: 'ASC' },
    });

    return comments.map((comment) => this.toTaskCommentSerializer(comment));
  }

  async addTaskComment(
    projectId: string,
    taskId: string,
    dto: AddCommentDto,
    requestUser: RequestUser,
  ): Promise<TaskCommentDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'create');

    const [task, actorUser] = await Promise.all([
      this.ensureTaskForSubresource(projectId, taskId),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    if (dto.parentCommentId) {
      await this.getCommentOrFail(taskId, dto.parentCommentId);
    }

    return this.commentRepo.manager.transaction(async (tx) => {
      const comment = await tx.save(
        tx.create(TaskComment, {
          task,
          taskId: task.id,
          authorUser: actorUser,
          authorUserId: actorUser.id,
          body: dto.body.trim(),
          parentCommentId: dto.parentCommentId ?? null,
          deletedAt: null,
        }),
      );

      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.COMMENT_ADDED,
        {
          commentId: comment.id,
        },
      );
      return this.toTaskCommentSerializer({
        ...comment,
        authorUser: actorUser,
      });
    });
  }

  async updateTaskComment(
    projectId: string,
    taskId: string,
    commentId: string,
    dto: UpdateCommentDto,
    requestUser: RequestUser,
  ): Promise<TaskCommentDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const [task, comment, actorUser] = await Promise.all([
      this.ensureTaskForSubresource(projectId, taskId),
      this.getCommentOrFail(taskId, commentId),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    if (comment.authorUserId !== requestUser.id) {
      throw new ForbiddenException(TASK_COMMENT_ACCESS_DENIED);
    }

    if (dto.body !== undefined) {
      comment.body = dto.body.trim();
    }

    return this.commentRepo.manager.transaction(async (tx) => {
      const saved = await tx.save(comment);
      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          commentId: saved.id,
          operation: 'comment_updated',
        },
      );
      return this.toTaskCommentSerializer({
        ...saved,
        authorUser: actorUser,
      });
    });
  }

  async deleteTaskComment(
    projectId: string,
    taskId: string,
    commentId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true }> {
    await this.verifyProjectPermission(projectId, requestUser, 'delete');

    const [task, comment, actorUser] = await Promise.all([
      this.ensureTaskForSubresource(projectId, taskId),
      this.getCommentOrFail(taskId, commentId),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    if (comment.authorUserId !== requestUser.id) {
      throw new ForbiddenException(TASK_COMMENT_ACCESS_DENIED);
    }

    await this.commentRepo.manager.transaction(async (tx) => {
      comment.deletedAt = new Date();
      await tx.save(comment);
      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_UPDATED,
        {
          commentId: comment.id,
          operation: 'comment_deleted',
        },
      );
    });

    return { id: commentId, success: true };
  }

  async getTaskChecklist(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskChecklistItemDetailSerializer[]> {
    await this.verifyProjectPermission(projectId, requestUser, 'view');
    await this.ensureTaskForSubresource(projectId, taskId);

    const items = await this.checklistRepo.find({
      where: { taskId },
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });

    return items.map((item) => this.toTaskChecklistItemSerializer(item));
  }

  async addChecklistItem(
    projectId: string,
    taskId: string,
    dto: AddChecklistItemDto,
    requestUser: RequestUser,
  ): Promise<TaskChecklistItemDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const [task, actorUser] = await Promise.all([
      this.ensureTaskForSubresource(projectId, taskId),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    return this.checklistRepo.manager.transaction(async (tx) => {
      const item = await tx.save(
        tx.create(TaskChecklistItem, {
          task,
          taskId: task.id,
          text: dto.text.trim(),
          orderIndex: 0,
          completed: false,
          completedByUserId: null,
          completedAt: null,
          checklistGroupId: dto.checklistGroupId ?? null,
        }),
      );

      await this.reorderChecklistItems(tx, task.id, item.id, dto.orderIndex);
      const savedItem = await tx.findOneByOrFail(TaskChecklistItem, {
        id: item.id,
        taskId: task.id,
      });

      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.CHECKLIST_UPDATED,
        {
          itemId: savedItem.id,
          operation: 'checklist_item_added',
        },
      );
      return this.toTaskChecklistItemSerializer(savedItem);
    });
  }

  async updateChecklistItem(
    projectId: string,
    taskId: string,
    itemId: string,
    dto: UpdateChecklistItemDto,
    requestUser: RequestUser,
  ): Promise<TaskChecklistItemDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const [task, item, actorUser] = await Promise.all([
      this.ensureTaskForSubresource(projectId, taskId),
      this.getChecklistItemOrFail(taskId, itemId),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    if (dto.text !== undefined) {
      item.text = dto.text.trim();
    }
    if (dto.orderIndex !== undefined) {
      item.orderIndex = dto.orderIndex;
    }
    if (dto.completed !== undefined) {
      item.completed = dto.completed;
      item.completedByUserId = dto.completed ? requestUser.id : null;
      item.completedAt = dto.completed ? new Date() : null;
    }
    if (dto.checklistGroupId !== undefined) {
      item.checklistGroupId = dto.checklistGroupId ?? null;
    }

    return this.checklistRepo.manager.transaction(async (tx) => {
      const saved = await tx.save(item);
      if (dto.orderIndex !== undefined) {
        await this.reorderChecklistItems(tx, task.id, saved.id, dto.orderIndex);
      }
      const refreshed = await tx.findOneByOrFail(TaskChecklistItem, {
        id: saved.id,
        taskId: task.id,
      });
      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.CHECKLIST_UPDATED,
        {
          itemId: refreshed.id,
          operation: 'checklist_item_updated',
        },
      );
      return this.toTaskChecklistItemSerializer(refreshed);
    });
  }

  async deleteChecklistItem(
    projectId: string,
    taskId: string,
    itemId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true }> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const [task, item, actorUser] = await Promise.all([
      this.ensureTaskForSubresource(projectId, taskId),
      this.getChecklistItemOrFail(taskId, itemId),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    await this.checklistRepo.manager.transaction(async (tx) => {
      await tx.remove(item);
      await this.reorderChecklistItems(tx, task.id, null);
      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.CHECKLIST_UPDATED,
        {
          itemId,
          operation: 'checklist_item_deleted',
        },
      );
    });

    return { id: itemId, success: true };
  }

  async getTaskDependencies(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskDependencyDetailSerializer[]> {
    await this.verifyProjectPermission(projectId, requestUser, 'view');
    await this.ensureTaskForSubresource(projectId, taskId);

    const dependencies = await this.dependencyRepo.find({
      where: { taskId },
      relations: ['dependsOnTask'],
      order: { createdAt: 'ASC' },
    });

    return dependencies.map((dependency) =>
      this.toTaskDependencySerializer(dependency),
    );
  }

  async addTaskDependency(
    projectId: string,
    taskId: string,
    dto: AddDependencyDto,
    requestUser: RequestUser,
  ): Promise<TaskDependencyDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const [task, actorUser, dependencyTask] = await Promise.all([
      this.ensureTaskForSubresource(projectId, taskId),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
      this.findOneOrFail(dto.dependsOnTaskId, projectId),
    ]);

    return this.dependencyRepo.manager.transaction(async (tx) => {
      const existing = await tx.findOne(TaskDependency, {
        where: { taskId, dependsOnTaskId: dto.dependsOnTaskId },
        relations: ['dependsOnTask'],
      });
      if (existing) {
        return this.toTaskDependencySerializer(existing);
      }

      await this.ensureNoDependencyCycle(tx, task.id, dependencyTask.id);
      const dependency = await tx.save(
        tx.create(TaskDependency, {
          task,
          taskId: task.id,
          dependsOnTask: dependencyTask,
          dependsOnTaskId: dependencyTask.id,
          dependencyType: dto.dependencyType ?? DependencyType.FINISH_TO_START,
          lagDays: dto.lagDays ?? null,
        }),
      );

      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.DEPENDENCY_ADDED,
        {
          dependencyId: dependency.id,
          dependsOnTaskId: dependency.dependsOnTaskId,
          operation: 'dependency_added',
        },
      );
      return this.toTaskDependencySerializer({
        ...dependency,
        dependsOnTask: dependencyTask,
      });
    });
  }

  async deleteTaskDependency(
    projectId: string,
    taskId: string,
    depId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true }> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');

    const [task, dependency, actorUser] = await Promise.all([
      this.ensureTaskForSubresource(projectId, taskId),
      this.getDependencyOrFail(taskId, depId),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
    ]);

    await this.dependencyRepo.manager.transaction(async (tx) => {
      await tx.remove(dependency);
      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.DEPENDENCY_REMOVED,
        {
          dependencyId: depId,
          dependsOnTaskId: dependency.dependsOnTaskId,
        },
      );
    });

    return { id: depId, success: true };
  }

  async deleteTask(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true; deletedTaskCount: number }> {
    await this.verifyProjectPermission(projectId, requestUser, 'delete');

    const [task, actorUser, allLiveTasks] = await Promise.all([
      this.taskRepo.findOne({
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['project'],
      }),
      this.userRepo.findOneOrFail({ where: { id: requestUser.id } }),
      this.taskRepo.find({
        where: { projectId, deletedAt: IsNull() },
        select: ['id', 'parentTaskId'],
      }),
    ]);

    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    const sourceScope = this.buildTaskScope(
      projectId,
      task.parentTaskId,
      task.statusId,
    );

    const toDelete = new Set<string>([task.id]);
    const queue = [task.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const candidate of allLiveTasks) {
        if (
          candidate.parentTaskId === currentId &&
          !toDelete.has(candidate.id)
        ) {
          toDelete.add(candidate.id);
          queue.push(candidate.id);
        }
      }
    }

    await this.taskRepo.manager.transaction(async (tx) => {
      await tx.update(
        Task,
        { id: In([...toDelete]) },
        { deletedAt: new Date() },
      );
      await this.rebalanceScopeRanks(tx, sourceScope);
      await this.logTaskActivity(
        tx,
        task,
        actorUser,
        TaskActionType.TASK_DELETED,
        {
          deletedCount: toDelete.size,
        },
      );
    });

    return { id: taskId, success: true, deletedTaskCount: toDelete.size };
  }

  async getTask(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'view');

    const task = await this.loadTaskOrFail(taskId, projectId);
    const counts = await this.computeCounts(task.id);
    const membershipRoleContext = await this.loadProjectRoleContextMap(
      projectId,
      [
        ...[task.reporteeUserId].filter((value): value is string =>
          Boolean(value),
        ),
        ...(task.assignees ?? []).map((assignee) => assignee.userId),
      ],
    );

    return this.toTaskSerializer(
      this.buildTaskReadModel(task, membershipRoleContext, {
        childCount: counts.childCount,
        commentCount: counts.commentCount,
      }),
    );
  }

  async getProjectTasks(
    projectId: string,
    filters: TaskFiltersDto,
    requestUser: RequestUser,
  ): Promise<
    FilterResponse<TaskListItemSerializer> & {
      meta: { projectId: string; flat: boolean };
    }
  > {
    await this.verifyProjectPermission(projectId, requestUser, 'view');

    // Parse and validate include param. Returns a Set of relation names to eager-load.
    const includes = this.parseIncludes(filters.include);
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const includeDeleted =
      filters.includeDeleted === true && this.isAdmin(requestUser);

    // Bug 3 fix: do NOT use .distinct(true). Instead, only join the relations that
    // are actually requested. Unconditional leftJoinAndSelect on one-to-many relations
    // produces duplicate rows in the result set, which forces DISTINCT, which in turn
    // breaks pagination counts and can cause TypeORM hydration issues (Bug 2).
    const qb = this.taskRepo
      .createQueryBuilder('task')
      .where('task.projectId = :projectId', { projectId });

    if (!includeDeleted) {
      qb.andWhere('task.deletedAt IS NULL');
    }

    if (filters.parentTaskId === 'root') {
      qb.andWhere('task.parentTaskId IS NULL');
    } else if (filters.parentTaskId) {
      qb.andWhere('task.parentTaskId = :parentTaskId', {
        parentTaskId: filters.parentTaskId,
      });
    } else if (filters.flat === false) {
      qb.andWhere('task.parentTaskId IS NULL');
    }

    if (filters.statusId) {
      qb.andWhere('task.statusId = :statusId', { statusId: filters.statusId });
    }

    if (filters.priorityId) {
      qb.andWhere('task.priorityId = :priorityId', { priorityId: filters.priorityId });
    }

    if (filters.taskTypeId) {
      qb.andWhere('task.taskTypeId = :taskTypeId', { taskTypeId: filters.taskTypeId });
    }

    if (filters.severityId) {
      qb.andWhere('task.severityId = :severityId', { severityId: filters.severityId });
    }

    const assignedUserId = filters.assignedUserId;
    if (assignedUserId) {
      // Use a raw EXISTS subquery instead of an innerJoin so that this filter never
      // occupies the task.assignees relation alias. If include=assignees is also active,
      // leftJoinAndSelect would clash with a second join on the same relation.
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM "task_assignees" "ta_filter"
          WHERE "ta_filter"."taskId" = task.id
            AND "ta_filter"."userId" = :assignedUserId
        )`,
        { assignedUserId },
      );
    }

    if (filters.reporteeUserId) {
      qb.andWhere('task.reporteeUserId = :reporteeUserId', {
        reporteeUserId: filters.reporteeUserId,
      });
    }

    if (filters.projectRoleId) {
      qb.andWhere(
        `(
          EXISTS (
            SELECT 1
            FROM "task_assignees" "ta_role"
            INNER JOIN "project_memberships" "pm_role"
              ON "pm_role"."projectId" = task."projectId"
             AND "pm_role"."userId" = "ta_role"."userId"
             AND "pm_role"."status" = :activeMembershipStatus
            WHERE "ta_role"."taskId" = task.id
              AND "pm_role"."projectRoleId" = :projectRoleId
          )
          OR EXISTS (
            SELECT 1
            FROM "project_memberships" "pm_reportee"
            WHERE "pm_reportee"."projectId" = task."projectId"
              AND "pm_reportee"."userId" = task."reporteeUserId"
              AND "pm_reportee"."status" = :activeMembershipStatus
              AND "pm_reportee"."projectRoleId" = :projectRoleId
          )
        )`,
        {
          projectRoleId: filters.projectRoleId,
          activeMembershipStatus: MembershipStatus.ACTIVE,
        },
      );
    }

    if (filters.search) {
      // description is now JSONB so we search only the title text column
      qb.andWhere('task.title ILIKE :search', { search: `%${filters.search}%` });
    }

    if (filters.startDateFrom) {
      qb.andWhere('task.startDate >= :startDateFrom', {
        startDateFrom: filters.startDateFrom,
      });
    }

    if (filters.startDateTo) {
      qb.andWhere('task.startDate <= :startDateTo', {
        startDateTo: filters.startDateTo,
      });
    }

    if (filters.endDateFrom) {
      qb.andWhere('task.endDate >= :endDateFrom', {
        endDateFrom: filters.endDateFrom,
      });
    }

    if (filters.endDateTo) {
      qb.andWhere('task.endDate <= :endDateTo', {
        endDateTo: filters.endDateTo,
      });
    }

    if (filters.hasIncompleteChecklist === true) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM "task_checklist_items" "tci_filter"
          WHERE "tci_filter"."taskId" = task.id
            AND "tci_filter"."completed" = false
        )`,
      );
    } else if (filters.hasIncompleteChecklist === false) {
      qb.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM "task_checklist_items" "tci_filter"
          WHERE "tci_filter"."taskId" = task.id
            AND "tci_filter"."completed" = false
        )`,
      );
    }

    // Bug 2 fix: always join assignees + user so that assignee names are always populated.
    // Bug 3 fix: only join optional one-to-many relations when explicitly requested via `include`.
    // This eliminates the duplicate-row problem that previously required DISTINCT and caused
    // incorrect pagination counts and broken TypeORM hydration.
    qb.leftJoinAndSelect('task.assignees', 'assignees')
      .leftJoinAndSelect('assignees.user', 'assigneeUser')
      .leftJoinAndSelect('task.reporteeUser', 'reporteeUser')
      // Always join config FK relations so snippets are available on all list responses
      .leftJoinAndSelect('task.status', 'status')
      .leftJoinAndSelect('task.priority', 'priority')
      .leftJoinAndSelect('task.taskType', 'taskType')
      .leftJoinAndSelect('task.severity', 'severity');

    if (includes.has('checklist')) {
      qb.leftJoinAndSelect('task.checklistItems', 'checklistItems');
    }
    if (includes.has('dependencies')) {
      qb.leftJoinAndSelect('task.dependencyEdges', 'dependencyEdges');
    }
    if (includes.has('comments')) {
      qb.leftJoinAndSelect('task.comments', 'comments', 'comments.deletedAt IS NULL');
    }
    if (includes.has('viewMeta')) {
      qb.leftJoinAndSelect('task.viewMetadataEntries', 'viewMetadataEntries');
    }

    // childCount: safe to use loadRelationCountAndMap — task.children is never joined above.
    qb.loadRelationCountAndMap(
      'task.childCount',
      'task.children',
      'children',
      (subQb) => subQb.andWhere('children.deletedAt IS NULL'),
    );
    // commentCount is fetched via a batch query below (not loadRelationCountAndMap) because
    // when include=comments the comments relation is already joined and a second join on the
    // same relation with a different alias would cause a TypeORM duplicate-alias error.

    const orderByAllowed = new Set([
      'title',
      'status',
      'priority',
      'startDate',
      'endDate',
      'rank',
      'createdAt',
      'updatedAt',
    ]);
    const orderBy =
      filters.orderBy && orderByAllowed.has(filters.orderBy)
        ? `task.${filters.orderBy}`
        : 'task.createdAt';

    qb.orderBy(orderBy, filters.sortOrder ?? 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [tasks, count] = await qb.getManyAndCount();

    // Batch-fetch comment counts for all returned tasks in a single query.
    const commentCountMap = new Map<string, number>();
    if (tasks.length > 0) {
      const rows = await this.commentRepo
        .createQueryBuilder('c')
        .select('c.taskId', 'taskId')
        .addSelect('COUNT(c.id)', 'cnt')
        .where('c.taskId IN (:...ids)', { ids: tasks.map((t) => t.id) })
        .andWhere('c.deletedAt IS NULL')
        .groupBy('c.taskId')
        .getRawMany<{ taskId: string; cnt: string }>();
      for (const row of rows) {
        commentCountMap.set(row.taskId, Number(row.cnt));
      }
    }

    const membershipRoleContext = await this.loadProjectRoleContextMap(
      projectId,
      tasks.flatMap((task) =>
        [
          task.reporteeUserId,
          ...(task.assignees ?? []).map((assignee) => assignee.userId),
        ].filter((value): value is string => Boolean(value)),
      ),
    );

    return {
      items: tasks.map((task) =>
        this.toTaskListItemSerializer(
          this.buildTaskReadModel(task, membershipRoleContext, {
            childCount: (task as Task & Partial<TaskCounts>).childCount ?? 0,
            commentCount: commentCountMap.get(task.id) ?? 0,
          }),
        ),
      ),
      meta: { projectId, flat: filters.flat ?? true },
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async findOneOrFail(taskId: string, projectId: string): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
    });

    if (!task) {
      throw new NotFoundException(TASK_NOT_FOUND);
    }

    return task;
  }

  // ── Checklist Groups ────────────────────────────────────────────────────────

  async getChecklistGroups(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskChecklistGroupDetailSerializer[]> {
    await this.verifyProjectPermission(projectId, requestUser, 'view');
    await this.ensureTaskForSubresource(projectId, taskId);

    const groups = await this.checklistGroupRepo.find({
      where: { taskId },
      relations: ['items'],
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });

    return groups.map((g) => this.toChecklistGroupSerializer(g));
  }

  async createChecklistGroup(
    projectId: string,
    taskId: string,
    dto: CreateChecklistGroupDto,
    requestUser: RequestUser,
  ): Promise<TaskChecklistGroupDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    const task = await this.ensureTaskForSubresource(projectId, taskId);

    const count = await this.checklistGroupRepo.count({ where: { taskId } });
    const orderIndex = dto.orderIndex ?? count;

    const group = await this.checklistGroupRepo.save(
      this.checklistGroupRepo.create({
        task,
        taskId: task.id,
        title: dto.title.trim(),
        orderIndex,
      }),
    );

    const withItems = await this.checklistGroupRepo.findOne({
      where: { id: group.id },
      relations: ['items'],
    });

    return this.toChecklistGroupSerializer(withItems ?? group);
  }

  async updateChecklistGroup(
    projectId: string,
    taskId: string,
    groupId: string,
    dto: UpdateChecklistGroupDto,
    requestUser: RequestUser,
  ): Promise<TaskChecklistGroupDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    await this.ensureTaskForSubresource(projectId, taskId);
    const group = await this.getChecklistGroupOrFail(taskId, groupId);

    if (dto.title !== undefined) group.title = dto.title.trim();
    if (dto.orderIndex !== undefined) group.orderIndex = dto.orderIndex;

    await this.checklistGroupRepo.save(group);

    const refreshed = await this.checklistGroupRepo.findOne({
      where: { id: group.id },
      relations: ['items'],
    });

    return this.toChecklistGroupSerializer(refreshed ?? group);
  }

  async deleteChecklistGroup(
    projectId: string,
    taskId: string,
    groupId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true }> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    await this.ensureTaskForSubresource(projectId, taskId);
    const group = await this.getChecklistGroupOrFail(taskId, groupId);

    // Ungroup items (SET NULL via FK) before removing the group
    await this.checklistGroupRepo.remove(group);

    return { id: groupId, success: true };
  }

  // ── Labels ──────────────────────────────────────────────────────────────────

  async getTaskLabels(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskLabelDetailSerializer[]> {
    await this.verifyProjectPermission(projectId, requestUser, 'view');
    await this.ensureTaskForSubresource(projectId, taskId);

    const labels = await this.taskLabelRepo.find({
      where: { taskId },
      relations: ['label'],
      order: { createdAt: 'ASC' },
    });

    return labels.map((l) => this.toTaskLabelSerializer(l));
  }

  async addTaskLabel(
    projectId: string,
    taskId: string,
    dto: AddLabelDto,
    requestUser: RequestUser,
  ): Promise<TaskLabelDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    const task = await this.ensureTaskForSubresource(projectId, taskId);

    // Ensure the label belongs to the same project
    const projectLabel = await this.projectLabelRepo.findOne({
      where: { id: dto.labelId, projectId },
    });
    if (!projectLabel) throw new BadRequestException(INVALID_TASK_LABEL);

    // Idempotency: return existing if already added
    const existing = await this.taskLabelRepo.findOne({
      where: { taskId, labelId: dto.labelId },
      relations: ['label'],
    });
    if (existing) throw new BadRequestException(TASK_LABEL_ALREADY_ADDED);

    const tl = await this.taskLabelRepo.save(
      this.taskLabelRepo.create({
        task,
        taskId: task.id,
        label: projectLabel,
        labelId: projectLabel.id,
      }),
    );

    return this.toTaskLabelSerializer({ ...tl, label: projectLabel });
  }

  async removeTaskLabel(
    projectId: string,
    taskId: string,
    taskLabelId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true }> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    await this.ensureTaskForSubresource(projectId, taskId);
    const tl = await this.getTaskLabelOrFail(taskId, taskLabelId);

    await this.taskLabelRepo.remove(tl);
    return { id: taskLabelId, success: true };
  }

  // ── Watchers ────────────────────────────────────────────────────────────────

  async getTaskWatchers(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskWatcherDetailSerializer[]> {
    await this.verifyProjectPermission(projectId, requestUser, 'view');
    await this.ensureTaskForSubresource(projectId, taskId);

    const watchers = await this.taskWatcherRepo.find({
      where: { taskId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });

    return watchers.map((w) => this.toTaskWatcherSerializer(w));
  }

  async addTaskWatcher(
    projectId: string,
    taskId: string,
    dto: AddWatcherDto,
    requestUser: RequestUser,
  ): Promise<TaskWatcherDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    const task = await this.ensureTaskForSubresource(projectId, taskId);

    // Ensure watcher is an active project member
    const membership = await this.membershipRepo.findOne({
      where: { projectId, userId: dto.userId, status: MembershipStatus.ACTIVE },
      relations: ['user'],
    });
    if (!membership) throw new BadRequestException(INVALID_TASK_WATCHER);

    const existing = await this.taskWatcherRepo.findOne({
      where: { taskId, userId: dto.userId },
    });
    if (existing) throw new BadRequestException(TASK_WATCHER_ALREADY_WATCHING);

    const watcher = await this.taskWatcherRepo.save(
      this.taskWatcherRepo.create({
        task,
        taskId: task.id,
        user: membership.user,
        userId: dto.userId,
      }),
    );

    return this.toTaskWatcherSerializer({ ...watcher, user: membership.user });
  }

  async removeTaskWatcher(
    projectId: string,
    taskId: string,
    watcherId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true }> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    await this.ensureTaskForSubresource(projectId, taskId);
    const watcher = await this.getTaskWatcherOrFail(taskId, watcherId);

    await this.taskWatcherRepo.remove(watcher);
    return { id: watcherId, success: true };
  }

  // ── Relations ───────────────────────────────────────────────────────────────

  async getTaskRelations(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
  ): Promise<TaskRelationDetailSerializer[]> {
    await this.verifyProjectPermission(projectId, requestUser, 'view');
    await this.ensureTaskForSubresource(projectId, taskId);

    // Return both outgoing (taskId = taskId) and incoming (relatedTaskId = taskId) as a unified list.
    // Each entry includes a `direction` field: 'outgoing' or 'incoming'.
    // For incoming edges the relatedTask is the *source* task; we normalize so
    // relatedTaskId always points to the *other* task from the viewer's perspective.
    const [outgoing, incoming] = await Promise.all([
      this.taskRelationRepo.find({
        where: { taskId },
        relations: ['relatedTask'],
        order: { createdAt: 'ASC' },
      }),
      this.taskRelationRepo.find({
        where: { relatedTaskId: taskId },
        relations: ['task'],
        order: { createdAt: 'ASC' },
      }),
    ]);

    const outgoingView = outgoing.map((r) => ({
      ...r,
      direction: 'outgoing' as const,
    }));

    const incomingView = incoming.map((r) => ({
      ...r,
      // Normalize: viewer's perspective — swap so relatedTask is the other task
      taskId: r.relatedTaskId,
      relatedTaskId: r.taskId,
      relatedTask: r.task,
      direction: 'incoming' as const,
    }));

    return [...outgoingView, ...incomingView].map((r) =>
      this.toTaskRelationSerializer(r),
    );
  }

  async addTaskRelation(
    projectId: string,
    taskId: string,
    dto: AddRelationDto,
    requestUser: RequestUser,
  ): Promise<TaskRelationDetailSerializer> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    const task = await this.ensureTaskForSubresource(projectId, taskId);

    if (dto.relatedTaskId === taskId) {
      throw new BadRequestException(TASK_RELATION_SELF);
    }

    const relatedTask = await this.taskRepo.findOne({
      where: { id: dto.relatedTaskId, projectId, deletedAt: IsNull() },
    });
    if (!relatedTask) throw new BadRequestException(INVALID_TASK_RELATION);

    // Check both directions for an existing link
    const existing = await this.taskRelationRepo.findOne({
      where: [
        { taskId, relatedTaskId: dto.relatedTaskId },
        { taskId: dto.relatedTaskId, relatedTaskId: taskId },
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

    return this.toTaskRelationSerializer({ ...relation, relatedTask });
  }

  async deleteTaskRelation(
    projectId: string,
    taskId: string,
    relationId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; success: true }> {
    await this.verifyProjectPermission(projectId, requestUser, 'update');
    await this.ensureTaskForSubresource(projectId, taskId);
    const relation = await this.getTaskRelationOrFail(taskId, relationId);

    await this.taskRelationRepo.remove(relation);
    return { id: relationId, success: true };
  }
}
