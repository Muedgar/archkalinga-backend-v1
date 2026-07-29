import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { FilterResponse } from 'src/common/interfaces';
import { ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import {
  ChangeRequest,
  ChangeRequestPriority,
  ChangeRequestStatus,
  Task,
  TaskComment,
  TaskRelation,
} from '../entities';
import {
  TaskFiltersDto,
  TaskMindmapCollapsedMode,
  TaskMindmapQueryDto,
  TaskTreeQueryDto,
} from '../dtos';
import { TASK_NOT_FOUND, TASK_PROJECT_ACCESS_DENIED } from '../messages';
import {
  TaskChecklistItemDetailSerializer,
  TaskListItemSerializer,
  TaskSerializer,
} from '../serializers';
import { TaskAuthService } from './task-auth.service';
import { TaskMembersService } from './task-members.service';

const TASK_TREE_INCLUDE_KEYS = new Set([
  'assignees',
  'assignedMembers',
  'checklist',
  'dependencies',
  'comments',
  'viewMeta',
  'activitySchedule',
  'counts',
  'progress',
  'status',
]);
const DEFAULT_TASK_TREE_NODE_LIMIT = 500;
const MAX_TASK_TREE_DEPTH = 25;
const TASK_MINDMAP_INCLUDE_KEYS = new Set([
  'checklist',
  'counts',
  'progress',
  'status',
  'assignees',
  'dependencies',
  'requests',
  'linkedTasks',
  'viewMeta',
  'permissions',
  'activitySchedule',
]);
const DEFAULT_TASK_MINDMAP_INCLUDES = new Set([
  'checklist',
  'counts',
  'progress',
  'status',
  'viewMeta',
  'permissions',
  'requests',
]);
const OPEN_CHANGE_REQUEST_STATUSES = [
  ChangeRequestStatus.NEW,
  ChangeRequestStatus.UNDER_REVIEW,
  ChangeRequestStatus.ESCALATED,
  ChangeRequestStatus.RETURNED_FOR_REVISION,
];
type MindmapCheckSeverity = 'error' | 'warning';

export type TaskTreeNode = {
  task: TaskListItemSerializer;
  children: TaskTreeNode[];
  checklistItems: TaskChecklistItemDetailSerializer[];
  counts: {
    childCount: number;
    descendantCount: number;
    checklistItemCount: number;
    completedChecklistItemCount: number;
    branchedChecklistItemCount: number;
    commentCount: number;
  };
  progress: {
    self: number | null;
    rollup: number | null;
    completed: boolean;
  };
  status: unknown;
};

export type TaskTreeResponse = {
  root: TaskTreeNode;
  summary: {
    descendantCount: number;
    taskCount: number;
    leafCount: number;
    completedTaskCount: number;
    checklistItemCount: number;
    completedChecklistItemCount: number;
    branchedChecklistItemCount: number;
    rollupProgress: number | null;
  };
  meta: {
    projectId: string;
    rootTaskId: string;
    depth: number | 'all';
    maxDepthVisited: number;
    limit: number;
    truncated: boolean;
    includeDeleted: boolean;
    includeCompleted: boolean;
    includeSuperseded: boolean;
    includes: string[];
  };
};

@Injectable()
export class TaskQueryService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskComment)
    private readonly commentRepo: Repository<TaskComment>,
    @InjectRepository(ChangeRequest)
    private readonly changeRequestRepo: Repository<ChangeRequest>,
    @InjectRepository(TaskRelation)
    private readonly relationRepo: Repository<TaskRelation>,
    private readonly authSvc: TaskAuthService,
    private readonly membersSvc: TaskMembersService,
  ) {}

  async getTask(
    projectId: string,
    taskId: string,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<TaskSerializer> {
    // Wave 1: auth check + task load + child count — all fire simultaneously.
    //
    // - prefetchedMembership comes from ProjectPermissionGuard (already ran) so its
    //   Promise.resolve() costs nothing — no DB hit.
    // - loadTaskOrFail internally fires 7 parallel queries (core task + 6 sub-resources),
    //   all in one Promise.all wave inside the method.
    // - childCount only needs taskId (known from the URL), so it fires alongside the task load.
    //
    // Net effect: the entire task fetch + child count completes in ONE DB round-trip wave.
    const [, task, childCount] = await Promise.all([
      prefetchedMembership !== undefined
        ? Promise.resolve({
            project: null as any,
            membership: prefetchedMembership,
          })
        : this.authSvc.verifyProjectPermission(projectId, requestUser, 'view'),
      this.authSvc.loadTaskOrFail(taskId, projectId),
      this.taskRepo.count({
        where: { parentTaskId: taskId, deletedAt: IsNull() },
      }),
    ]);

    const canView = await this.authSvc.canViewTask(task, requestUser);
    if (!canView) throw new ForbiddenException(TASK_PROJECT_ACCESS_DENIED);

    const userIds = [
      task.reporteeUserId,
      ...(task.assignees ?? []).map((a) => a.userId),
    ].filter((v): v is string => Boolean(v));

    // Wave 2: role context — requires assignee userIds from wave 1, so unavoidably sequential.
    // Comment count is derived from already-loaded task.comments (no extra query).
    const roleContext = await this.membersSvc.loadProjectRoleContextMap(
      projectId,
      userIds,
    );
    const commentCount = task.comments.length;

    return this.authSvc.toTaskSerializer(
      this.membersSvc.buildTaskReadModel(task, roleContext, {
        childCount,
        commentCount,
      }),
    );
  }

  async getProjectTasks(
    projectId: string,
    filters: TaskFiltersDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<
    FilterResponse<TaskListItemSerializer> & {
      meta: { projectId: string; flat: boolean };
    }
  > {
    // ── Auth ──────────────────────────────────────────────────────────────
    //
    // prefetchedMembership comes from ProjectPermissionGuard (already ran) via
    // req.projectMembership, so Promise.resolve() costs zero DB queries.
    // Without prefetching this would be 2 sequential queries (project + membership).
    if (prefetchedMembership === undefined) {
      await this.authSvc.verifyProjectPermission(
        projectId,
        requestUser,
        'view',
      );
    }

    const includes = this.authSvc.parseIncludes(filters.include);
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const includeDeleted =
      filters.includeDeleted === true && this.authSvc.isAdmin(requestUser);
    const includeSuperseded = filters.includeSuperseded === true;

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .where('task.projectId = :projectId', { projectId });
    if (!includeDeleted) qb.andWhere('task.deletedAt IS NULL');
    if (!includeSuperseded) qb.andWhere('task.supersededByTaskId IS NULL');

    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
    );
    this.authSvc.applyTaskVisibilityScope(
      qb,
      requestUser,
      canViewAllProjectTasks,
    );

    // ── Hierarchy filter ──────────────────────────────────────────────────
    if (filters.parentTaskId === 'root')
      qb.andWhere('task.parentTaskId IS NULL');
    else if (filters.parentTaskId)
      qb.andWhere('task.parentTaskId = :parentTaskId', {
        parentTaskId: filters.parentTaskId,
      });
    else if (filters.flat === false) qb.andWhere('task.parentTaskId IS NULL');

    // ── Scalar FK filters ─────────────────────────────────────────────────
    if (filters.statusId)
      qb.andWhere('task.statusId = :statusId', { statusId: filters.statusId });
    if (filters.priorityId)
      qb.andWhere('task.priorityId = :priorityId', {
        priorityId: filters.priorityId,
      });
    if (filters.taskTypeId)
      qb.andWhere('task.taskTypeId = :taskTypeId', {
        taskTypeId: filters.taskTypeId,
      });
    if (filters.severityId)
      qb.andWhere('task.severityId = :severityId', {
        severityId: filters.severityId,
      });
    if (filters.scheduleType)
      qb.andWhere('task.scheduleType = :scheduleType', {
        scheduleType: filters.scheduleType,
      });

    // ── Assignee filter (EXISTS subquery avoids duplicate rows) ───────────
    if (filters.assignedUserId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM "task_assignees" "ta_f" WHERE "ta_f"."taskId" = task.id AND "ta_f"."userId" = :assignedUserId)`,
        { assignedUserId: filters.assignedUserId },
      );
    }

    if (filters.reporteeUserId)
      qb.andWhere('task.reporteeUserId = :reporteeUserId', {
        reporteeUserId: filters.reporteeUserId,
      });

    // ── Role filter ───────────────────────────────────────────────────────
    if (filters.projectRoleId) {
      qb.andWhere(
        `(EXISTS (
            SELECT 1 FROM "task_assignees" "ta_r"
            INNER JOIN "project_memberships" "pm_r"
              ON "pm_r"."projectId" = task."projectId"
             AND "pm_r"."userId" = "ta_r"."userId"
             AND "pm_r"."status" = :ams
            WHERE "ta_r"."taskId" = task.id AND "pm_r"."projectRoleId" = :projectRoleId
          ) OR EXISTS (
            SELECT 1 FROM "project_memberships" "pm_rep"
            WHERE "pm_rep"."projectId" = task."projectId"
              AND "pm_rep"."userId" = task."reporteeUserId"
              AND "pm_rep"."status" = :ams
              AND "pm_rep"."projectRoleId" = :projectRoleId
          ))`,
        { projectRoleId: filters.projectRoleId, ams: MembershipStatus.ACTIVE },
      );
    }

    // ── Text & date filters ───────────────────────────────────────────────
    if (filters.search)
      qb.andWhere('task.title ILIKE :search', {
        search: `%${filters.search}%`,
      });
    if (filters.startDateFrom)
      qb.andWhere('task.startDate >= :startDateFrom', {
        startDateFrom: filters.startDateFrom,
      });
    if (filters.startDateTo)
      qb.andWhere('task.startDate <= :startDateTo', {
        startDateTo: filters.startDateTo,
      });
    if (filters.endDateFrom)
      qb.andWhere('task.endDate >= :endDateFrom', {
        endDateFrom: filters.endDateFrom,
      });
    if (filters.endDateTo)
      qb.andWhere('task.endDate <= :endDateTo', {
        endDateTo: filters.endDateTo,
      });

    // ── Checklist completion filter ───────────────────────────────────────
    if (filters.hasIncompleteChecklist === true) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM "task_checklist_items" "tci" WHERE "tci"."taskId" = task.id AND "tci"."completed" = false)`,
      );
    } else if (filters.hasIncompleteChecklist === false) {
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM "task_checklist_items" "tci" WHERE "tci"."taskId" = task.id AND "tci"."completed" = false)`,
      );
    }

    // ── Always-on joins (assignees, config FKs) ───────────────────────────
    qb.leftJoinAndSelect('task.assignees', 'assignees')
      .leftJoinAndSelect('assignees.user', 'assigneeUser')
      .leftJoinAndSelect('task.reporteeUser', 'reporteeUser')
      .leftJoinAndSelect('task.status', 'status')
      .leftJoinAndSelect('task.priority', 'priority')
      .leftJoinAndSelect('task.taskType', 'taskType')
      .leftJoinAndSelect('task.severity', 'severity')
      .leftJoinAndSelect('task.activitySchedule', 'activitySchedule');

    // ── Optional includes ─────────────────────────────────────────────────
    if (includes.has('checklist'))
      qb.leftJoinAndSelect('task.checklistItems', 'checklistItems');
    if (includes.has('dependencies'))
      qb.leftJoinAndSelect('task.dependencyEdges', 'dependencyEdges');
    if (includes.has('comments'))
      qb.leftJoinAndSelect(
        'task.comments',
        'comments',
        'comments.deletedAt IS NULL',
      );
    if (includes.has('viewMeta'))
      qb.leftJoinAndSelect('task.viewMetadataEntries', 'viewMetadataEntries');

    qb.loadRelationCountAndMap(
      'task.childCount',
      'task.children',
      'children',
      (sub) => sub.andWhere('children.deletedAt IS NULL'),
    );

    // ── Order & pagination ────────────────────────────────────────────────
    const orderByAllowed = new Set([
      'title',
      'status',
      'priority',
      'startDate',
      'endDate',
      'rank',
      'wbsCode',
      'wbsSortKey',
      'createdAt',
      'updatedAt',
    ]);
    const orderBy =
      filters.orderBy && orderByAllowed.has(filters.orderBy)
        ? `task.${filters.orderBy}`
        : 'task.createdAt';
    qb.orderBy(orderBy, filters.sortOrder ?? 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    // ── Wave 1: main paginated query ──────────────────────────────────────
    const [tasks, count] = await qb.getManyAndCount();

    // ── Wave 2: comment counts + roleContext — fire in parallel ───────────
    //
    // Both depend only on the task list from wave 1 and are independent of each other.
    //
    // Comment count optimization: when include=comments, the main query already
    // joined task.comments so the data is in-memory — derive the count for free
    // instead of issuing a redundant GROUP BY query.
    const taskIds = tasks.map((t) => t.id);
    const userIds = tasks.flatMap((t) =>
      [t.reporteeUserId, ...(t.assignees ?? []).map((a) => a.userId)].filter(
        (v): v is string => Boolean(v),
      ),
    );

    const commentCountQuery: Promise<{ taskId: string; cnt: string }[] | null> =
      includes.has('comments')
        ? Promise.resolve(null) // already in-memory — skip the DB round-trip entirely
        : tasks.length > 0
          ? this.commentRepo
              .createQueryBuilder('c')
              .select('c.taskId', 'taskId')
              .addSelect('COUNT(c.id)', 'cnt')
              .where('c.taskId IN (:...ids)', { ids: taskIds })
              .andWhere('c.deletedAt IS NULL')
              .groupBy('c.taskId')
              .getRawMany<{ taskId: string; cnt: string }>()
          : Promise.resolve([]);

    const [commentRows, roleContext] = await Promise.all([
      commentCountQuery,
      this.membersSvc.loadProjectRoleContextMap(projectId, userIds),
    ]);

    // Assemble comment count map — from DB rows OR from in-memory comments
    const commentCountMap = new Map<string, number>();
    if (commentRows === null) {
      // include=comments was set: counts already in-memory on task.comments
      for (const task of tasks)
        commentCountMap.set(task.id, (task.comments ?? []).length);
    } else {
      for (const row of commentRows)
        commentCountMap.set(row.taskId, Number(row.cnt));
    }

    return {
      items: tasks.map((task) =>
        this.authSvc.toTaskListItemSerializer(
          this.membersSvc.buildTaskReadModel(task, roleContext, {
            childCount: (task as any).childCount ?? 0,
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

  async getTaskTree(
    projectId: string,
    taskId: string,
    query: TaskTreeQueryDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<TaskTreeResponse> {
    if (prefetchedMembership === undefined) {
      await this.authSvc.verifyProjectPermission(
        projectId,
        requestUser,
        'view',
      );
    }

    const depth = query.depth ?? 'all';
    if (depth !== 'all' && (!Number.isInteger(depth) || depth < 0)) {
      throw new BadRequestException(
        'depth must be a non-negative integer or "all"',
      );
    }

    const includes = this.parseTreeIncludes(query.include);
    const includeDeleted =
      query.includeDeleted === true && this.authSvc.isAdmin(requestUser);
    const includeCompleted = query.includeCompleted ?? true;
    const includeSuperseded = query.includeSuperseded === true;
    const limit = query.limit ?? DEFAULT_TASK_TREE_NODE_LIMIT;
    const canViewAllProjectTasks = await this.authSvc.canViewAllProjectTasks(
      projectId,
      requestUser,
    );

    const rootTasks = await this.loadTreeTasks(
      projectId,
      [taskId],
      includes,
      requestUser,
      canViewAllProjectTasks,
      includeDeleted,
      includeCompleted,
      true,
      'id',
    );
    const rootTask = rootTasks[0];
    if (!rootTask) throw new NotFoundException(TASK_NOT_FOUND);

    const canViewRoot = await this.authSvc.canViewTask(rootTask, requestUser);
    if (!canViewRoot) throw new ForbiddenException(TASK_PROJECT_ACCESS_DENIED);

    const allTasks: Task[] = [rootTask];
    let frontierIds = [rootTask.id];
    let level = 0;
    let maxDepthVisited = 0;
    let truncated = false;
    const maxDepth = depth === 'all' ? MAX_TASK_TREE_DEPTH : depth;

    while (frontierIds.length > 0 && level < maxDepth) {
      const remaining = limit - allTasks.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      const children = await this.loadTreeTasks(
        projectId,
        frontierIds,
        includes,
        requestUser,
        canViewAllProjectTasks,
        includeDeleted,
        includeCompleted,
        includeSuperseded,
        'parent',
        remaining,
      );
      if (!children.length) break;

      if (children.length >= remaining) truncated = true;
      allTasks.push(...children);
      frontierIds = children.map((child) => child.id);
      level += 1;
      maxDepthVisited = level;

      if (truncated) break;
    }

    if (depth === 'all' && level >= MAX_TASK_TREE_DEPTH && frontierIds.length) {
      truncated = true;
    }

    const allTaskIds = allTasks.map((task) => task.id);
    const userIds = allTasks.flatMap((task) =>
      [
        task.reporteeUserId,
        ...(task.assignees ?? []).map((a) => a.userId),
      ].filter((v): v is string => Boolean(v)),
    );
    const [roleContext, directChildCountMap, commentCountMap] =
      await Promise.all([
        this.membersSvc.loadProjectRoleContextMap(projectId, userIds),
        this.loadDirectChildCountMap(
          projectId,
          allTaskIds,
          requestUser,
          canViewAllProjectTasks,
          includeDeleted,
          includeCompleted,
          includeSuperseded,
        ),
        this.loadCommentCountMap(allTaskIds),
      ]);

    const nodes = new Map<string, TaskTreeNode>();
    for (const task of allTasks) {
      const checklistItems = [...(task.checklistItems ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      nodes.set(task.id, {
        task: this.authSvc.toTaskListItemSerializer(
          this.membersSvc.buildTaskReadModel(task, roleContext, {
            childCount: directChildCountMap.get(task.id) ?? 0,
            commentCount: commentCountMap.get(task.id) ?? 0,
          }),
        ),
        children: [],
        checklistItems: includes.has('checklist')
          ? checklistItems.map((item) => this.toTreeChecklistItem(item))
          : [],
        counts: {
          childCount: directChildCountMap.get(task.id) ?? 0,
          descendantCount: 0,
          checklistItemCount: checklistItems.length,
          completedChecklistItemCount: checklistItems.filter(
            (item) => item.completed,
          ).length,
          branchedChecklistItemCount: checklistItems.filter((item) =>
            Boolean(item.branchedTaskId),
          ).length,
          commentCount: commentCountMap.get(task.id) ?? 0,
        },
        progress: {
          self: task.progress ?? null,
          rollup: task.progress ?? null,
          completed: task.completed,
        },
        status: task.status ?? null,
      });
    }

    for (const task of allTasks) {
      if (!task.parentTaskId) continue;
      const parent = nodes.get(task.parentTaskId);
      const child = nodes.get(task.id);
      if (parent && child) parent.children.push(child);
    }

    const root = nodes.get(rootTask.id)!;
    this.applyTreeRollups(root);

    return {
      root,
      summary: this.buildTreeSummary(root),
      meta: {
        projectId,
        rootTaskId: rootTask.id,
        depth,
        maxDepthVisited,
        limit,
        truncated,
        includeDeleted,
        includeCompleted,
        includeSuperseded,
        includes: [...includes],
      },
    };
  }

  async getTaskMindmap(
    projectId: string,
    taskId: string,
    query: TaskMindmapQueryDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ) {
    const includes = this.parseMindmapIncludes(query.include);
    const tree = await this.getTaskTree(
      projectId,
      taskId,
      {
        depth: query.depth,
        limit: query.limit,
        include: this.toTreeIncludeCsv(includes),
        includeCompleted: query.includeCompleted,
        includeDeleted: query.includeDeleted,
        includeSuperseded: query.includeSuperseded,
      },
      requestUser,
      prefetchedMembership,
    );
    const visibleNodeIds = new Set<string>();
    const hiddenByCollapse = new Set<string>();
    const rootCollapsedMode =
      query.collapsedMode ?? TaskMindmapCollapsedMode.RESPECT;

    const allNodes = this.flattenTree(tree.root);
    const requestCountMap = includes.has('requests')
      ? await this.loadRequestCountMap(allNodes.map((node) => node.task.id))
      : new Map<
          string,
          { openRequestCount: number; urgentRequestCount: number }
        >();
    const linkedRelations = includes.has('linkedTasks')
      ? await this.loadVisibleRelationEdges(
          allNodes.map((node) => node.task.id),
        )
      : [];
    const canUpdate = includes.has('permissions')
      ? await this.canUpdateProjectTasks(projectId, requestUser)
      : false;

    const nodes: Array<ReturnType<typeof this.toMindmapNode>> = [];
    const edges: Array<Record<string, unknown>> = [];
    const flatChecklistItems: Array<Record<string, unknown>> = [];
    const stack: Array<{ node: TaskTreeNode; hidden: boolean }> = [
      { node: tree.root, hidden: false },
    ];

    while (stack.length) {
      const { node, hidden } = stack.pop()!;
      const collapsed =
        rootCollapsedMode === TaskMindmapCollapsedMode.RESPECT &&
        this.isMindmapCollapsed(node.task);
      if (hidden) {
        hiddenByCollapse.add(node.task.id);
      } else {
        visibleNodeIds.add(node.task.id);
        const requestCounts = requestCountMap.get(node.task.id) ?? {
          openRequestCount: 0,
          urgentRequestCount: 0,
        };
        nodes.push(
          this.toMindmapNode(
            node,
            requestCounts,
            includes,
            canUpdate,
            requestUser,
          ),
        );

        if (includes.has('checklist')) {
          for (const item of node.checklistItems) {
            if (item.branchedTaskId) {
              if (!collapsed) {
                edges.push({
                  id: `${item.id}:${item.branchedTaskId}`,
                  type: 'branched-checklist-item',
                  sourceTaskId: node.task.id,
                  targetTaskId: item.branchedTaskId,
                  checklistItemId: item.id,
                  checklistItemCode: item.itemCode,
                });
              }
            } else {
              flatChecklistItems.push({
                id: item.id,
                taskId: item.taskId,
                itemCode: item.itemCode,
                text: item.text,
                completed: item.completed,
                orderIndex: item.orderIndex,
                checklistGroupId: item.checklistGroupId,
                branchedTaskId: null,
                branchStatus: item.branchStatus,
                completedAt: item.completedAt,
                completedByUserId: item.completedByUserId,
              });
            }
          }
        }
      }

      for (const child of [...node.children].reverse()) {
        const childHidden = hidden || collapsed;
        if (!childHidden) {
          edges.push({
            id: `${node.task.id}:${child.task.id}`,
            type: 'child-task',
            sourceTaskId: node.task.id,
            targetTaskId: child.task.id,
            checklistItemId: this.findBranchingChecklistItemId(
              node,
              child.task.id,
            ),
            checklistItemCode: this.findBranchingChecklistItemCode(
              node,
              child.task.id,
            ),
          });
        }
        stack.push({ node: child, hidden: childHidden });
      }
    }

    if (includes.has('linkedTasks')) {
      for (const relation of linkedRelations) {
        if (
          visibleNodeIds.has(relation.taskId) &&
          visibleNodeIds.has(relation.relatedTaskId)
        ) {
          edges.push({
            id: relation.id,
            type: 'linked-task',
            relationType: relation.relationType,
            sourceTaskId: relation.taskId,
            targetTaskId: relation.relatedTaskId,
            checklistItemId: null,
            checklistItemCode: null,
          });
        }
      }
    }

    return {
      meta: {
        projectId,
        rootTaskId: tree.meta.rootTaskId,
        depth: tree.meta.depth,
        maxDepthVisited: tree.meta.maxDepthVisited,
        limit: tree.meta.limit,
        truncated: tree.meta.truncated,
        includeCompleted: tree.meta.includeCompleted,
        includeDeleted: tree.meta.includeDeleted,
        includeSuperseded: tree.meta.includeSuperseded,
        collapsedMode: rootCollapsedMode,
        includes: [...includes],
        generatedAt: new Date().toISOString(),
      },
      summary: {
        ...tree.summary,
        visibleTaskCount: nodes.length,
        hiddenByCollapseCount: hiddenByCollapse.size,
        openRequestCount: [...requestCountMap.values()].reduce(
          (sum, count) => sum + count.openRequestCount,
          0,
        ),
        urgentRequestCount: [...requestCountMap.values()].reduce(
          (sum, count) => sum + count.urgentRequestCount,
          0,
        ),
      },
      data: {
        rootId: tree.meta.rootTaskId,
        nodes,
        edges,
        flatChecklistItems,
      },
    };
  }

  async getTaskMindmapChecks(
    projectId: string,
    taskId: string,
    query: TaskMindmapQueryDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ) {
    const tree = await this.getTaskTree(
      projectId,
      taskId,
      {
        depth: query.depth,
        limit: query.limit,
        include: 'checklist,counts,progress,status,viewMeta',
        includeCompleted: query.includeCompleted,
        includeDeleted: query.includeDeleted,
        includeSuperseded: query.includeSuperseded,
      },
      requestUser,
      prefetchedMembership,
    );
    const nodes = this.flattenTree(tree.root);
    const nodeById = new Map(nodes.map((node) => [node.task.id, node]));
    const issues: Array<{
      severity: MindmapCheckSeverity;
      code: string;
      message: string;
      taskId?: string;
      wbsCode?: string | null;
    }> = [];

    if (tree.meta.truncated) {
      issues.push({
        severity: 'warning',
        code: 'excessive_depth',
        message:
          'Mindmap response was truncated by depth or node limit; expand a smaller branch to inspect the full structure',
        taskId: tree.meta.rootTaskId,
      });
    }

    const wbsSeen = new Map<string, string>();
    for (const node of nodes) {
      if (node.task.wbsCode) {
        const existingTaskId = wbsSeen.get(node.task.wbsCode);
        if (existingTaskId) {
          issues.push({
            severity: 'error',
            code: 'duplicate_wbs',
            message: `Duplicate WBS code "${node.task.wbsCode}" in visible Mindmap subtree`,
            taskId: node.task.id,
            wbsCode: node.task.wbsCode,
          });
        } else {
          wbsSeen.set(node.task.wbsCode, node.task.id);
        }
      }
      if (node.task.supersededByTaskId && !query.includeSuperseded) {
        issues.push({
          severity: 'warning',
          code: 'superseded_visible_in_active_view',
          message:
            'Superseded task is visible in the active Mindmap projection',
          taskId: node.task.id,
          wbsCode: node.task.wbsCode,
        });
      }
      for (const item of node.checklistItems) {
        if (item.branchedTaskId && !nodeById.has(item.branchedTaskId)) {
          issues.push({
            severity: 'error',
            code: 'branch_missing_child_task',
            message:
              'Checklist item is marked branched but its child task is missing from the visible subtree',
            taskId: node.task.id,
            wbsCode: node.task.wbsCode,
          });
        }
      }
    }

    for (const node of nodes) {
      if (!node.task.parentTaskId) continue;
      const parent = nodeById.get(node.task.parentTaskId);
      if (!parent) continue;
      const branchSource = parent.checklistItems.find(
        (item) => item.branchedTaskId === node.task.id,
      );
      if (!branchSource) {
        issues.push({
          severity: 'warning',
          code: 'child_missing_branch_source',
          message:
            'Child task has no parent checklist item pointing to it as a branched task',
          taskId: node.task.id,
          wbsCode: node.task.wbsCode,
        });
      }
    }

    return this.mindmapChecksResponse(projectId, tree.meta.rootTaskId, issues);
  }

  private parseTreeIncludes(raw?: string): Set<string> {
    const defaults = new Set(['checklist', 'counts', 'progress', 'status']);
    if (!raw) return defaults;

    const includes = new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    for (const include of includes) {
      if (!TASK_TREE_INCLUDE_KEYS.has(include)) {
        throw new BadRequestException(`Invalid task tree include: ${include}`);
      }
    }
    return includes;
  }

  private parseMindmapIncludes(raw?: string): Set<string> {
    if (!raw) return new Set(DEFAULT_TASK_MINDMAP_INCLUDES);
    const includes = new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    for (const include of includes) {
      if (!TASK_MINDMAP_INCLUDE_KEYS.has(include)) {
        throw new BadRequestException(
          `Invalid task Mindmap include: ${include}`,
        );
      }
    }
    return includes;
  }

  private mindmapChecksResponse(
    projectId: string,
    rootTaskId: string,
    issues: Array<{
      severity: MindmapCheckSeverity;
      code: string;
      message: string;
      taskId?: string;
      wbsCode?: string | null;
    }>,
  ) {
    return {
      meta: {
        projectId,
        rootTaskId,
        generatedAt: new Date().toISOString(),
      },
      summary: {
        valid: issues.every((issue) => issue.severity !== 'error'),
        errorCount: issues.filter((issue) => issue.severity === 'error').length,
        warningCount: issues.filter((issue) => issue.severity === 'warning')
          .length,
      },
      data: { issues },
    };
  }

  private toTreeIncludeCsv(includes: Set<string>): string {
    const treeIncludes = new Set<string>([
      'checklist',
      'counts',
      'progress',
      'status',
    ]);
    for (const include of includes) {
      if (TASK_TREE_INCLUDE_KEYS.has(include)) treeIncludes.add(include);
      if (include === 'permissions') treeIncludes.add('assignees');
    }
    if (includes.has('viewMeta')) treeIncludes.add('viewMeta');
    return [...treeIncludes].join(',');
  }

  private flattenTree(root: TaskTreeNode): TaskTreeNode[] {
    const nodes: TaskTreeNode[] = [];
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      nodes.push(node);
      stack.push(...[...node.children].reverse());
    }
    return nodes;
  }

  private toMindmapNode(
    node: TaskTreeNode,
    requestCounts: { openRequestCount: number; urgentRequestCount: number },
    includes: Set<string>,
    canUpdate: boolean,
    requestUser: RequestUser,
  ) {
    const task = node.task;
    return {
      id: task.id,
      taskCode: task.wbsCode,
      wbsCode: task.wbsCode,
      parentTaskId: task.parentTaskId,
      title: task.title,
      scheduleType: task.scheduleType,
      track: task.taskType?.key ?? task.taskType?.name ?? null,
      status: includes.has('status') ? task.status : undefined,
      progress: includes.has('progress') ? node.progress : undefined,
      counts: includes.has('counts')
        ? {
            ...node.counts,
            openRequestCount: requestCounts.openRequestCount,
            urgentRequestCount: requestCounts.urgentRequestCount,
          }
        : undefined,
      assignees: includes.has('assignees') ? task.assignedMembers : undefined,
      viewMeta: includes.has('viewMeta')
        ? {
            mindmap:
              (task.viewMeta?.mindmap as Record<string, unknown> | undefined) ??
              {},
          }
        : undefined,
      permissions: includes.has('permissions')
        ? {
            canView: true,
            canEdit: canUpdate,
            canBranchChecklistItem: canUpdate,
            canCreateRequest:
              task.reportee?.userId === requestUser.id ||
              (task.assignedMembers ?? []).some(
                (member) => member.userId === requestUser.id,
              ),
          }
        : undefined,
    };
  }

  private isMindmapCollapsed(task: TaskListItemSerializer): boolean {
    const mindmapMeta = task.viewMeta?.mindmap;
    return Boolean(
      mindmapMeta &&
      typeof mindmapMeta === 'object' &&
      'collapsed' in mindmapMeta &&
      (mindmapMeta as { collapsed?: unknown }).collapsed === true,
    );
  }

  private findBranchingChecklistItemId(
    node: TaskTreeNode,
    childTaskId: string,
  ): string | null {
    return (
      node.checklistItems.find((item) => item.branchedTaskId === childTaskId)
        ?.id ?? null
    );
  }

  private findBranchingChecklistItemCode(
    node: TaskTreeNode,
    childTaskId: string,
  ): string | null {
    return (
      node.checklistItems.find((item) => item.branchedTaskId === childTaskId)
        ?.itemCode ?? null
    );
  }

  private async loadRequestCountMap(
    taskIds: string[],
  ): Promise<
    Map<string, { openRequestCount: number; urgentRequestCount: number }>
  > {
    if (!taskIds.length) return new Map();
    const rows = await this.changeRequestRepo
      .createQueryBuilder('changeRequest')
      .select('changeRequest.taskId', 'taskId')
      .addSelect('COUNT(changeRequest.id)', 'openRequestCount')
      .addSelect(
        `SUM(CASE WHEN changeRequest.priority = :critical THEN 1 ELSE 0 END)`,
        'urgentRequestCount',
      )
      .where('changeRequest.taskId IN (:...taskIds)', { taskIds })
      .andWhere('changeRequest.status IN (:...statuses)', {
        statuses: OPEN_CHANGE_REQUEST_STATUSES,
      })
      .setParameter('critical', ChangeRequestPriority.CRITICAL)
      .groupBy('changeRequest.taskId')
      .getRawMany<{
        taskId: string;
        openRequestCount: string;
        urgentRequestCount: string | null;
      }>();

    return new Map(
      rows.map((row) => [
        row.taskId,
        {
          openRequestCount: Number(row.openRequestCount),
          urgentRequestCount: Number(row.urgentRequestCount ?? 0),
        },
      ]),
    );
  }

  private async loadVisibleRelationEdges(
    taskIds: string[],
  ): Promise<TaskRelation[]> {
    if (!taskIds.length) return [];
    return this.relationRepo.find({
      where: [
        { taskId: In(taskIds), relatedTaskId: In(taskIds) },
        { relatedTaskId: In(taskIds), taskId: In(taskIds) },
      ],
    });
  }

  private async canUpdateProjectTasks(
    projectId: string,
    requestUser: RequestUser,
  ): Promise<boolean> {
    try {
      await this.authSvc.verifyProjectPermission(
        projectId,
        requestUser,
        'update',
      );
      return true;
    } catch {
      return false;
    }
  }

  private toTreeChecklistItem(
    item: Task['checklistItems'][number],
  ): TaskChecklistItemDetailSerializer {
    return {
      id: item.id,
      pkid: item.pkid,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      taskId: item.taskId,
      checklistGroupId: item.checklistGroupId,
      itemCode: item.itemCode,
      branchedTaskId: item.branchedTaskId,
      branchStatus: item.branchStatus,
      branchedByUserId: item.branchedByUserId,
      branchedAt: item.branchedAt,
      text: item.text,
      completed: item.completed,
      orderIndex: item.orderIndex,
      completedByUserId: item.completedByUserId,
      completedAt: item.completedAt,
    };
  }

  private async loadTreeTasks(
    projectId: string,
    ids: string[],
    includes: Set<string>,
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
    includeDeleted: boolean,
    includeCompleted: boolean,
    includeSuperseded: boolean,
    mode: 'id' | 'parent',
    limit?: number,
  ): Promise<Task[]> {
    if (!ids.length) return [];

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .where(`task.${mode === 'id' ? 'id' : 'parentTaskId'} IN (:...ids)`, {
        ids,
      })
      .andWhere('task.projectId = :projectId', { projectId });

    if (!includeDeleted) qb.andWhere('task.deletedAt IS NULL');
    if (!includeCompleted) qb.andWhere('task.completed = false');
    if (!includeSuperseded) qb.andWhere('task.supersededByTaskId IS NULL');
    this.authSvc.applyTaskVisibilityScope(
      qb,
      requestUser,
      canViewAllProjectTasks,
    );

    qb.leftJoinAndSelect('task.assignees', 'assignees')
      .leftJoinAndSelect('assignees.user', 'assigneeUser')
      .leftJoinAndSelect('task.reporteeUser', 'reporteeUser')
      .leftJoinAndSelect('task.status', 'status')
      .leftJoinAndSelect('task.priority', 'priority')
      .leftJoinAndSelect('task.taskType', 'taskType')
      .leftJoinAndSelect('task.severity', 'severity');

    if (includes.has('activitySchedule')) {
      qb.leftJoinAndSelect('task.activitySchedule', 'activitySchedule');
    }
    qb.leftJoinAndSelect('task.checklistItems', 'checklistItems');
    if (includes.has('dependencies')) {
      qb.leftJoinAndSelect('task.dependencyEdges', 'dependencyEdges');
    }
    if (includes.has('comments')) {
      qb.leftJoinAndSelect(
        'task.comments',
        'comments',
        'comments.deletedAt IS NULL',
      );
    }
    if (includes.has('viewMeta')) {
      qb.leftJoinAndSelect('task.viewMetadataEntries', 'viewMetadataEntries');
    }

    qb.orderBy('task.wbsSortKey', 'ASC', 'NULLS LAST')
      .addOrderBy('task.rank', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'ASC');

    if (limit !== undefined) qb.take(limit);
    return qb.getMany();
  }

  private async loadDirectChildCountMap(
    projectId: string,
    taskIds: string[],
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
    includeDeleted: boolean,
    includeCompleted: boolean,
    includeSuperseded: boolean,
  ): Promise<Map<string, number>> {
    if (!taskIds.length) return new Map();

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .select('task.parentTaskId', 'parentTaskId')
      .addSelect('COUNT(task.id)', 'cnt')
      .where('task.parentTaskId IN (:...taskIds)', { taskIds })
      .andWhere('task.projectId = :projectId', { projectId });

    if (!includeDeleted) qb.andWhere('task.deletedAt IS NULL');
    if (!includeCompleted) qb.andWhere('task.completed = false');
    if (!includeSuperseded) qb.andWhere('task.supersededByTaskId IS NULL');
    this.authSvc.applyTaskVisibilityScope(
      qb,
      requestUser,
      canViewAllProjectTasks,
    );

    const rows = await qb
      .groupBy('task.parentTaskId')
      .getRawMany<{ parentTaskId: string; cnt: string }>();

    return new Map(rows.map((row) => [row.parentTaskId, Number(row.cnt)]));
  }

  private async loadCommentCountMap(
    taskIds: string[],
  ): Promise<Map<string, number>> {
    if (!taskIds.length) return new Map();

    const rows = await this.commentRepo
      .createQueryBuilder('comment')
      .select('comment.taskId', 'taskId')
      .addSelect('COUNT(comment.id)', 'cnt')
      .where('comment.taskId IN (:...taskIds)', { taskIds })
      .andWhere('comment.deletedAt IS NULL')
      .groupBy('comment.taskId')
      .getRawMany<{ taskId: string; cnt: string }>();

    return new Map(rows.map((row) => [row.taskId, Number(row.cnt)]));
  }

  private applyTreeRollups(node: TaskTreeNode): void {
    let descendantCount = 0;
    let progressTotal = node.progress.self ?? 0;
    let progressCount = node.progress.self === null ? 0 : 1;

    for (const child of node.children) {
      this.applyTreeRollups(child);
      descendantCount += 1 + child.counts.descendantCount;
      if (child.progress.rollup !== null) {
        progressTotal += child.progress.rollup;
        progressCount += 1;
      }
    }

    node.counts.descendantCount = descendantCount;
    node.progress.rollup =
      progressCount > 0 ? Math.round(progressTotal / progressCount) : null;
  }

  private buildTreeSummary(root: TaskTreeNode): TaskTreeResponse['summary'] {
    const stack = [root];
    let taskCount = 0;
    let leafCount = 0;
    let completedTaskCount = 0;
    let checklistItemCount = 0;
    let completedChecklistItemCount = 0;
    let branchedChecklistItemCount = 0;

    while (stack.length) {
      const node = stack.pop()!;
      taskCount += 1;
      if (!node.children.length) leafCount += 1;
      if (node.progress.completed) completedTaskCount += 1;
      checklistItemCount += node.counts.checklistItemCount;
      completedChecklistItemCount += node.counts.completedChecklistItemCount;
      branchedChecklistItemCount += node.counts.branchedChecklistItemCount;
      stack.push(...node.children);
    }

    return {
      descendantCount: root.counts.descendantCount,
      taskCount,
      leafCount,
      completedTaskCount,
      checklistItemCount,
      completedChecklistItemCount,
      branchedChecklistItemCount,
      rollupProgress: root.progress.rollup,
    };
  }

  async findOneOrFail(taskId: string, projectId: string): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
    });
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    return task;
  }
}
