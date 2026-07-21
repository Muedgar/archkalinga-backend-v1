import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  IsNull,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { Project, ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import type { ProjectPermissionAction } from 'src/projects/types/project-permission-matrix.type';
import type { ProjectPermissionDomain } from 'src/projects/types/project-permission-matrix.type';
import { User } from 'src/users/entities';
import {
  WorkspaceMember,
  WorkspaceMemberStatus,
} from 'src/workspaces/entities';
import {
  ChangeRequest,
  Task,
  TaskActivitySchedule,
  TaskAssignee,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskLabel,
  TaskViewMetadata,
} from '../entities';
import { ProjectStatus } from '../project-config';
import {
  INVALID_CHANGE_REQUEST_ESCALATION_PARENT_REPORTEE,
  INVALID_CHANGE_REQUEST_ESCALATION_ROOT_TASK,
  TASK_CHANGE_REQUEST_ACCESS_DENIED,
  INVALID_TASK_DATE_RANGE,
  INVALID_TASK_INCLUDE,
  INVALID_TASK_PARENT,
  TASK_NOT_FOUND,
  TASK_PROJECT_ACCESS_DENIED,
  TASK_PROJECT_NOT_FOUND,
  TASK_STATUS_WIP_LIMIT_EXCEEDED,
  TOO_MANY_TASK_INCLUDES,
} from '../messages';
import { TaskListItemSerializer, TaskSerializer } from '../serializers';
import { TaskMembersService } from './task-members.service';
import { plainToInstance } from 'class-transformer';

// ── Constants ─────────────────────────────────────────────────────────────────

export const TASK_INCLUDE_KEYS = new Set([
  'assignedMembers',
  'reportee',
  'checklist',
  'dependencies',
  'comments',
  'viewMeta',
  'activitySchedule',
]);
export const MAX_TASK_LIST_INCLUDES = 6;

type ChangeRequestTaskAccess = Pick<
  Task,
  'id' | 'projectId' | 'parentTaskId' | 'reporteeUserId' | 'assignees'
>;

type ChangeRequestAccess = Pick<
  ChangeRequest,
  'createdByUserId' | 'escalatedToUserId'
>;

@Injectable()
export class TaskAuthService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
    @InjectRepository(WorkspaceMember)
    private readonly workspaceMemberRepo: Repository<WorkspaceMember>,
    @InjectRepository(ProjectStatus)
    private readonly projectStatusRepo: Repository<ProjectStatus>,
    @InjectRepository(TaskComment)
    private readonly commentRepo: Repository<TaskComment>,
    @InjectRepository(TaskAssignee)
    private readonly taskAssigneeRepo: Repository<TaskAssignee>,
    @InjectRepository(TaskChecklistItem)
    private readonly checklistItemRepo: Repository<TaskChecklistItem>,
    @InjectRepository(TaskDependency)
    private readonly dependencyEdgeRepo: Repository<TaskDependency>,
    @InjectRepository(TaskLabel)
    private readonly taskLabelRepo: Repository<TaskLabel>,
    @InjectRepository(TaskViewMetadata)
    private readonly viewMetadataRepo: Repository<TaskViewMetadata>,
    @InjectRepository(TaskActivitySchedule)
    private readonly scheduleRepo: Repository<TaskActivitySchedule>,
    private readonly membersSvc: TaskMembersService,
  ) {}

  // ── Serializers (used by query + crud services) ───────────────────────────

  toTaskSerializer(task: any): TaskSerializer {
    return plainToInstance(TaskSerializer, task, {
      excludeExtraneousValues: true,
    });
  }

  toTaskListItemSerializer(task: any): TaskListItemSerializer {
    return plainToInstance(TaskListItemSerializer, task, {
      excludeExtraneousValues: true,
    });
  }

  // ── Validation helpers ────────────────────────────────────────────────────

  parseIncludes(raw?: string): Set<string> {
    if (!raw) return new Set();
    const includes = new Set(
      raw
        .split(',')
        .map((v) => v.trim())
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

  ensureDateRange(startDate?: string | null, endDate?: string | null): void {
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException(INVALID_TASK_DATE_RANGE);
    }
  }

  async assertWipLimit(
    tx: EntityManager,
    statusId: string,
    projectId: string,
    excludeTaskId?: string,
  ): Promise<void> {
    const status = await tx.findOne(ProjectStatus, {
      where: { id: statusId, projectId },
    });
    if (!status?.wipLimit) return;

    const qb = tx
      .createQueryBuilder(Task, 'task')
      .where('task.statusId = :statusId', { statusId })
      .andWhere('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL');

    if (excludeTaskId)
      qb.andWhere('task.id != :excludeTaskId', { excludeTaskId });

    const count = await qb.getCount();
    if (count >= status.wipLimit)
      throw new BadRequestException(TASK_STATUS_WIP_LIMIT_EXCEEDED);
  }

  async ensureParentTask(
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

  // ── Auth ──────────────────────────────────────────────────────────────────

  isAdmin(_user: RequestUser): boolean {
    return false;
  }

  membershipHasTaskPermission(
    membership: ProjectMembership | null | undefined,
    action: ProjectPermissionAction,
    domain: ProjectPermissionDomain = 'taskManagement',
  ): boolean {
    return (
      membership?.status === MembershipStatus.ACTIVE &&
      membership.projectRole?.status === true &&
      membership.projectRole.permissions?.[domain]?.[action] === true
    );
  }

  async canViewAllProjectTasks(
    projectId: string,
    requestUser: RequestUser,
    project?: Project | null,
  ): Promise<boolean> {
    const resolvedProject =
      project ??
      (await this.projectRepo.findOne({
        where: { id: projectId },
        select: ['pkid', 'id', 'workspaceId', 'createdByUserId'],
      }));

    if (!resolvedProject) throw new NotFoundException(TASK_PROJECT_NOT_FOUND);
    if (resolvedProject.createdByUserId === requestUser.id) return true;

    const [workspaceMember, membership] = await Promise.all([
      this.workspaceMemberRepo.findOne({
        where: {
          workspaceId: resolvedProject.workspaceId,
          userId: requestUser.id,
          status: WorkspaceMemberStatus.ACTIVE,
        },
        relations: ['workspaceRole'],
      }),
      this.membershipRepo.findOne({
        where: {
          projectId,
          userId: requestUser.id,
          status: MembershipStatus.ACTIVE,
        },
        relations: ['projectRole'],
      }),
    ]);

    if (
      workspaceMember?.workspaceRole?.status === true &&
      workspaceMember.workspaceRole.slug === 'admin'
    ) {
      return true;
    }

    return (
      membership?.status === MembershipStatus.ACTIVE &&
      membership.projectRole?.status === true &&
      membership.projectRole.permissions?.taskManagement?.view === true &&
      membership.projectRole.permissions.taskManagement.viewScope === 'all'
    );
  }

  async canViewTask(
    task: Pick<
      Task,
      'id' | 'projectId' | 'createdByUserId' | 'reporteeUserId' | 'assignees'
    >,
    requestUser: RequestUser,
    project?: Project | null,
  ): Promise<boolean> {
    if (await this.canViewAllProjectTasks(task.projectId, requestUser, project)) {
      return true;
    }

    const membership = await this.membershipRepo.findOne({
      where: {
        projectId: task.projectId,
        userId: requestUser.id,
        status: MembershipStatus.ACTIVE,
      },
      relations: ['projectRole'],
    });

    if (!this.membershipHasTaskPermission(membership, 'view')) return false;

    return (
      task.createdByUserId === requestUser.id ||
      task.reporteeUserId === requestUser.id ||
      (task.assignees ?? []).some((a) => a.userId === requestUser.id)
    );
  }

  private isTaskAssignee(
    task: Pick<Task, 'assignees'>,
    userId: string,
  ): boolean {
    return (task.assignees ?? []).some(
      (assignee) => assignee.userId === userId,
    );
  }

  private isTaskReportee(
    task: Pick<Task, 'reporteeUserId'>,
    userId: string,
  ): boolean {
    return task.reporteeUserId === userId;
  }

  canCreateChangeRequest(
    task: ChangeRequestTaskAccess,
    requestUser: RequestUser,
  ): boolean {
    return (
      this.isTaskAssignee(task, requestUser.id) ||
      this.isTaskReportee(task, requestUser.id)
    );
  }

  canEscalateChangeRequest(
    task: ChangeRequestTaskAccess,
    requestUser: RequestUser,
  ): boolean {
    return this.canCreateChangeRequest(task, requestUser);
  }

  canResolveChangeRequest(
    task: ChangeRequestTaskAccess,
    requestUser: RequestUser,
  ): boolean {
    return this.isTaskReportee(task, requestUser.id);
  }

  canAccessChangeRequest(
    changeRequest: ChangeRequestAccess,
    task: ChangeRequestTaskAccess,
    requestUser: RequestUser,
  ): boolean {
    return (
      changeRequest.createdByUserId === requestUser.id ||
      changeRequest.escalatedToUserId === requestUser.id ||
      this.isTaskAssignee(task, requestUser.id) ||
      this.isTaskReportee(task, requestUser.id)
    );
  }

  ensureChangeRequestTaskParticipant(
    task: ChangeRequestTaskAccess,
    requestUser: RequestUser,
  ): void {
    if (!this.canCreateChangeRequest(task, requestUser)) {
      throw new ForbiddenException(TASK_CHANGE_REQUEST_ACCESS_DENIED);
    }
  }

  async ensureParentTaskReportee(task: ChangeRequestTaskAccess): Promise<Task> {
    if (!task.parentTaskId) {
      throw new BadRequestException(
        INVALID_CHANGE_REQUEST_ESCALATION_ROOT_TASK,
      );
    }

    const parentTask = await this.taskRepo.findOne({
      where: {
        id: task.parentTaskId,
        projectId: task.projectId,
        deletedAt: IsNull(),
      },
      select: [
        'pkid',
        'id',
        'projectId',
        'parentTaskId',
        'createdByUserId',
        'reporteeUserId',
      ],
    });

    if (!parentTask?.reporteeUserId) {
      throw new BadRequestException(
        INVALID_CHANGE_REQUEST_ESCALATION_PARENT_REPORTEE,
      );
    }

    return parentTask;
  }

  applyTaskVisibilityScope(
    qb: SelectQueryBuilder<any>,
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
  ): void {
    if (canViewAllProjectTasks) return;

    // Assigned-only members keep a narrow task surface: tasks they created,
    // tasks where they are the reportee, or tasks where they are an assignee.
    // Watchers are intentionally notification subscribers, not visibility grants.
    qb.andWhere(
      `(task.createdByUserId = :visibilityUserId
        OR task.reporteeUserId = :visibilityUserId
        OR EXISTS (
          SELECT 1
          FROM "task_assignees" "ta_visibility"
          WHERE "ta_visibility"."taskId" = task.id
            AND "ta_visibility"."userId" = :visibilityUserId
        ))`,
      { visibilityUserId: requestUser.id },
    );
  }

  applyChangeRequestVisibilityScope(
    qb: SelectQueryBuilder<any>,
    requestUser: RequestUser,
    canViewAllProjectTasks: boolean,
    alias = 'changeRequest',
  ): void {
    if (canViewAllProjectTasks) return;

    qb.andWhere(
      `("${alias}"."created_by_user_id" = :visibilityUserId
        OR "${alias}"."escalated_to_user_id" = :visibilityUserId
        OR EXISTS (
          SELECT 1
          FROM "tasks" "task_visibility"
          WHERE "task_visibility"."id" = "${alias}"."task_id"
            AND "task_visibility"."reporteeUserId" = :visibilityUserId
        )
        OR EXISTS (
          SELECT 1
          FROM "task_assignees" "ta_change_request_visibility"
          WHERE "ta_change_request_visibility"."taskId" = "${alias}"."task_id"
            AND "ta_change_request_visibility"."userId" = :visibilityUserId
        )
        OR EXISTS (
          SELECT 1
          FROM "change_request_reviews" "cr_review_visibility"
          WHERE "cr_review_visibility"."change_request_id" = "${alias}"."id"
            AND "cr_review_visibility"."reviewer_user_id" = :visibilityUserId
        ))`,
      { visibilityUserId: requestUser.id },
    );
  }

  async verifyProjectPermission(
    projectId: string,
    requestUser: RequestUser,
    action: ProjectPermissionAction,
    domain: ProjectPermissionDomain = 'taskManagement',
  ): Promise<{ project: Project; membership: ProjectMembership | null }> {
    // Load project and membership in parallel — both are independent queries
    const [project, membership] = await Promise.all([
      this.projectRepo.findOne({
        where: { id: projectId },
        select: ['pkid', 'id', 'workspaceId', 'createdByUserId'],
      }),
      this.membershipRepo.findOne({
        where: {
          projectId,
          userId: requestUser.id,
          status: MembershipStatus.ACTIVE,
        },
        relations: ['projectRole'],
      }),
    ]);

    if (!project) throw new NotFoundException(TASK_PROJECT_NOT_FOUND);
    if (this.isAdmin(requestUser)) return { project, membership: null };

    if (!this.membershipHasTaskPermission(membership, action, domain)) {
      throw new ForbiddenException(TASK_PROJECT_ACCESS_DENIED);
    }

    return { project, membership: membership ?? null };
  }

  async ensureTaskForSubresource(
    projectId: string,
    taskId: string,
    opts?: { requestUser?: RequestUser; membership?: ProjectMembership | null },
  ): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
      relations: ['assignees', 'project'],
    });

    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    if (opts?.requestUser && opts?.membership !== undefined) {
      const canView = await this.canViewTask(task, opts.requestUser);
      if (!canView) throw new ForbiddenException(TASK_PROJECT_ACCESS_DENIED);
    }

    return task;
  }

  // ── Data loaders ──────────────────────────────────────────────────────────

  async loadTaskOrFail(taskId: string, projectId: string): Promise<Task> {
    // Fire all 7 queries simultaneously in a single Promise.all wave.
    //
    // taskId is known from the URL before the handler runs, so sub-resource queries
    // do not need to wait for the core task row to come back first.  If the task
    // does not exist the sub-resource queries return empty arrays — a small no-op cost
    // for the rare case of a 404, in exchange for eliminating an entire sequential
    // round-trip on every successful request.
    //
    // This replaces the old single-query approach which caused a Cartesian product:
    //   3 assignees × 10 comments × 8 checklist items × 4 deps × 3 labels × 2 viewMeta
    //   = 5,760 rows transferred for ONE task, collapsed by TypeORM in JS.
    const [
      task,
      assignees,
      checklistItems,
      comments,
      dependencyEdges,
      labels,
      viewMetadataEntries,
      activitySchedule,
    ] = await Promise.all([
      this.taskRepo
        .createQueryBuilder('task')
        .leftJoinAndSelect('task.reporteeUser', 'reporteeUser')
        .leftJoinAndSelect('task.status', 'status')
        .leftJoinAndSelect('task.priority', 'priority')
        .leftJoinAndSelect('task.taskType', 'taskType')
        .leftJoinAndSelect('task.severity', 'severity')
        .select([
          'task.pkid',
          'task.id',
          'task.projectId',
          'task.parentTaskId',
          'task.statusId',
          'task.priorityId',
          'task.taskTypeId',
          'task.severityId',
          'task.title',
          'task.description',
          'task.startDate',
          'task.endDate',
          'task.progress',
          'task.completed',
          'task.rank',
          'task.createdByUserId',
          'task.reporteeUserId',
          'task.deletedAt',
          'task.createdAt',
          'task.updatedAt',
          'reporteeUser.pkid',
          'reporteeUser.id',
          'reporteeUser.firstName',
          'reporteeUser.lastName',
          'reporteeUser.email',
          'reporteeUser.title',
          'status.pkid',
          'status.id',
          'status.name',
          'status.key',
          'status.color',
          'status.category',
          'status.isTerminal',
          'priority.pkid',
          'priority.id',
          'priority.name',
          'priority.key',
          'priority.color',
          'taskType.pkid',
          'taskType.id',
          'taskType.name',
          'taskType.key',
          'taskType.color',
          'severity.pkid',
          'severity.id',
          'severity.name',
          'severity.key',
          'severity.color',
        ])
        .where('task.id = :taskId', { taskId })
        .andWhere('task.projectId = :projectId', { projectId })
        .andWhere('task.deletedAt IS NULL')
        .getOne(),
      this.taskAssigneeRepo
        .createQueryBuilder('assignee')
        .leftJoinAndSelect('assignee.user', 'user')
        .select([
          'assignee.pkid',
          'assignee.id',
          'assignee.taskId',
          'assignee.userId',
          'assignee.projectRoleId',
          'assignee.assignmentRole',
          'user.pkid',
          'user.id',
          'user.firstName',
          'user.lastName',
          'user.email',
          'user.title',
        ])
        .where('assignee.taskId = :taskId', { taskId })
        .getMany(),
      this.checklistItemRepo
        .createQueryBuilder('item')
        .select([
          'item.pkid',
          'item.id',
          'item.taskId',
          'item.text',
          'item.completed',
          'item.orderIndex',
          'item.completedByUserId',
          'item.completedAt',
        ])
        .where('item.taskId = :taskId', { taskId })
        .orderBy('item.orderIndex', 'ASC')
        .getMany(),
      this.commentRepo
        .createQueryBuilder('comment')
        .select([
          'comment.pkid',
          'comment.id',
          'comment.taskId',
          'comment.authorUserId',
          'comment.body',
          'comment.parentCommentId',
          'comment.deletedAt',
          'comment.createdAt',
          'comment.updatedAt',
        ])
        .where('comment.taskId = :taskId', { taskId })
        .andWhere('comment.deletedAt IS NULL')
        .orderBy('comment.createdAt', 'ASC')
        .getMany(),
      this.dependencyEdgeRepo
        .createQueryBuilder('dependency')
        .select([
          'dependency.pkid',
          'dependency.id',
          'dependency.taskId',
          'dependency.dependsOnTaskId',
          'dependency.dependencyType',
          'dependency.lagDays',
        ])
        .where('dependency.taskId = :taskId', { taskId })
        .getMany(),
      this.taskLabelRepo
        .createQueryBuilder('taskLabel')
        .leftJoinAndSelect('taskLabel.label', 'label')
        .select([
          'taskLabel.pkid',
          'taskLabel.id',
          'taskLabel.taskId',
          'taskLabel.labelId',
          'label.pkid',
          'label.id',
          'label.name',
          'label.key',
          'label.color',
        ])
        .where('taskLabel.taskId = :taskId', { taskId })
        .getMany(),
      this.viewMetadataRepo
        .createQueryBuilder('viewMeta')
        .select([
          'viewMeta.pkid',
          'viewMeta.id',
          'viewMeta.taskId',
          'viewMeta.viewType',
          'viewMeta.metaJson',
        ])
        .where('viewMeta.taskId = :taskId', { taskId })
        .getMany(),
      this.scheduleRepo.findOne({ where: { taskId } }),
    ]);

    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    task.assignees = assignees;
    task.checklistItems = checklistItems;
    task.comments = comments; // already filtered: deletedAt IS NULL
    task.dependencyEdges = dependencyEdges;
    task.labels = labels;
    task.viewMetadataEntries = viewMetadataEntries;
    task.activitySchedule = activitySchedule;

    return task;
  }

  async loadTasksForList(
    taskIds: string[],
    projectId: string,
  ): Promise<TaskListItemSerializer[]> {
    if (!taskIds.length) return [];

    // Fire core task query + all sub-resource queries in a single Promise.all wave.
    //
    // The old approach loaded all 13 relations via a single find() call, which caused
    // TypeORM to emit one massive SQL with 13 LEFT JOINs — a Cartesian product across
    // every OneToMany relation. For N tasks each with K rows per relation, that's K^M
    // rows transferred and collapsed in JS.
    //
    // taskIds are already known, so all sub-resource queries can fire simultaneously
    // without waiting for the core task rows first.
    const idSet = taskIds; // already validated non-empty above

    const [
      tasks,
      assignees,
      checklistItems,
      comments,
      dependencyEdges,
      labels,
      viewMetadataEntries,
    ] = await Promise.all([
      this.taskRepo.find({
        where: { id: In(idSet), projectId, deletedAt: IsNull() },
        relations: [
          'reporteeUser',
          'status',
          'priority',
          'taskType',
          'severity',
        ],
        order: { createdAt: 'DESC' },
      }),
      this.taskAssigneeRepo.find({
        where: { taskId: In(idSet) },
        relations: ['user'],
      }),
      this.checklistItemRepo.find({ where: { taskId: In(idSet) } }),
      this.commentRepo.find({
        where: { taskId: In(idSet), deletedAt: IsNull() },
      }),
      this.dependencyEdgeRepo.find({ where: { taskId: In(idSet) } }),
      this.taskLabelRepo.find({
        where: { taskId: In(idSet) },
        relations: ['label'],
      }),
      this.viewMetadataRepo.find({ where: { taskId: In(idSet) } }),
    ]);

    // Group sub-resources by taskId for O(1) lookup during assembly
    const assigneeMap = new Map<string, typeof assignees>();
    const checklistMap = new Map<string, typeof checklistItems>();
    const commentMap = new Map<string, typeof comments>();
    const depMap = new Map<string, typeof dependencyEdges>();
    const labelMap = new Map<string, typeof labels>();
    const viewMetaMap = new Map<string, typeof viewMetadataEntries>();

    for (const r of assignees) {
      const a = assigneeMap.get(r.taskId) ?? [];
      a.push(r);
      assigneeMap.set(r.taskId, a);
    }
    for (const r of checklistItems) {
      const a = checklistMap.get(r.taskId) ?? [];
      a.push(r);
      checklistMap.set(r.taskId, a);
    }
    for (const r of comments) {
      const a = commentMap.get(r.taskId) ?? [];
      a.push(r);
      commentMap.set(r.taskId, a);
    }
    for (const r of dependencyEdges) {
      const a = depMap.get(r.taskId) ?? [];
      a.push(r);
      depMap.set(r.taskId, a);
    }
    for (const r of labels) {
      const a = labelMap.get(r.taskId) ?? [];
      a.push(r);
      labelMap.set(r.taskId, a);
    }
    for (const r of viewMetadataEntries) {
      const a = viewMetaMap.get(r.taskId) ?? [];
      a.push(r);
      viewMetaMap.set(r.taskId, a);
    }

    // Stitch sub-resources onto task objects in-memory (zero extra queries)
    for (const task of tasks) {
      task.assignees = assigneeMap.get(task.id) ?? [];
      task.checklistItems = checklistMap.get(task.id) ?? [];
      task.comments = commentMap.get(task.id) ?? [];
      task.dependencyEdges = depMap.get(task.id) ?? [];
      task.labels = labelMap.get(task.id) ?? [];
      task.viewMetadataEntries = viewMetaMap.get(task.id) ?? [];
    }

    // Wave 2: child counts + roleContext — both fire in parallel.
    //
    // commentCount is derived from the already-loaded comments (free, no extra query).
    // childCount needs a GROUP BY query (children are not loaded in this path).
    // roleContext needs assignee userIds from wave 1 (now assembled), so it must come after.
    // Both are independent of each other, so we fire them together.
    const userIds = tasks.flatMap((t) =>
      [t.reporteeUserId, ...(t.assignees ?? []).map((a) => a.userId)].filter(
        (v): v is string => Boolean(v),
      ),
    );

    const [childRows, roleContext] = await Promise.all([
      this.taskRepo
        .createQueryBuilder('t')
        .select('t.parentTaskId', 'parentTaskId')
        .addSelect('COUNT(t.id)', 'cnt')
        .where('t.parentTaskId IN (:...ids)', { ids: tasks.map((t) => t.id) })
        .andWhere('t.deletedAt IS NULL')
        .groupBy('t.parentTaskId')
        .getRawMany<{ parentTaskId: string; cnt: string }>(),
      this.membersSvc.loadProjectRoleContextMap(projectId, userIds),
    ]);

    const childCountMap = new Map(
      childRows.map((r) => [r.parentTaskId, Number(r.cnt)]),
    );

    return tasks.map((task) =>
      this.toTaskListItemSerializer(
        this.membersSvc.buildTaskReadModel(task, roleContext, {
          childCount: childCountMap.get(task.id) ?? 0,
          commentCount: commentMap.get(task.id)?.length ?? 0, // in-memory, zero extra query
        }),
      ),
    );
  }
}
