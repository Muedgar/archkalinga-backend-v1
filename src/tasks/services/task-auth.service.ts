import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { Project, ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import type { ProjectPermissionAction } from 'src/projects/types/project-permission-matrix.type';
import { User } from 'src/users/entities';
import {
  Task,
  TaskAssignee,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskLabel,
  TaskViewMetadata,
} from '../entities';
import { ProjectStatus } from '../project-config';
import {
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
  'assignedMembers', 'reportee', 'checklist', 'dependencies', 'comments', 'viewMeta',
]);
export const MAX_TASK_LIST_INCLUDES = 6;

@Injectable()
export class TaskAuthService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
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
    private readonly membersSvc: TaskMembersService,
  ) {}

  // ── Serializers (used by query + crud services) ───────────────────────────

  toTaskSerializer(task: any): TaskSerializer {
    return plainToInstance(TaskSerializer, task, { excludeExtraneousValues: true });
  }

  toTaskListItemSerializer(task: any): TaskListItemSerializer {
    return plainToInstance(TaskListItemSerializer, task, { excludeExtraneousValues: true });
  }

  // ── Validation helpers ────────────────────────────────────────────────────

  parseIncludes(raw?: string): Set<string> {
    if (!raw) return new Set();
    const includes = new Set(raw.split(',').map((v) => v.trim()).filter(Boolean));
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
    const status = await tx.findOne(ProjectStatus, { where: { id: statusId, projectId } });
    if (!status?.wipLimit) return;

    const qb = tx
      .createQueryBuilder(Task, 'task')
      .where('task.statusId = :statusId', { statusId })
      .andWhere('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL');

    if (excludeTaskId) qb.andWhere('task.id != :excludeTaskId', { excludeTaskId });

    const count = await qb.getCount();
    if (count >= status.wipLimit) throw new BadRequestException(TASK_STATUS_WIP_LIMIT_EXCEEDED);
  }

  async ensureParentTask(projectId: string, parentTaskId?: string | null): Promise<Task | null> {
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
  ): Promise<{ project: Project; membership: ProjectMembership | null }> {
    // Load project and membership in parallel — both are independent queries
    const [project, membership] = await Promise.all([
      this.projectRepo.findOne({ where: { id: projectId } }),
      this.membershipRepo.findOne({
        where: { projectId, userId: requestUser.id, status: MembershipStatus.ACTIVE },
        relations: ['projectRole'],
      }),
    ]);

    if (!project) throw new NotFoundException(TASK_PROJECT_NOT_FOUND);
    if (this.isAdmin(requestUser)) return { project, membership: null };

    if (!this.membershipHasTaskPermission(membership, action)) {
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
      relations: ['project', 'assignees'],
    });

    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    if (opts?.requestUser && opts?.membership !== undefined) {
      const viewScope =
        (opts.membership?.projectRole?.permissions?.taskManagement as any)?.viewScope ?? 'all';
      if (viewScope === 'assigned') {
        const isAssignee = (task.assignees ?? []).some((a) => a.userId === opts.requestUser!.id);
        const isReportee = task.reporteeUserId === opts.requestUser!.id;
        if (!isAssignee && !isReportee) throw new ForbiddenException(TASK_PROJECT_ACCESS_DENIED);
      }
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
    ]);

    if (!task) throw new NotFoundException(TASK_NOT_FOUND);

    task.assignees           = assignees;
    task.checklistItems      = checklistItems;
    task.comments            = comments;  // already filtered: deletedAt IS NULL
    task.dependencyEdges     = dependencyEdges;
    task.labels              = labels;
    task.viewMetadataEntries = viewMetadataEntries;

    return task;
  }

  async loadTasksForList(taskIds: string[], projectId: string): Promise<TaskListItemSerializer[]> {
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
        relations: ['reporteeUser', 'status', 'priority', 'taskType', 'severity'],
        order: { createdAt: 'DESC' },
      }),
      this.taskAssigneeRepo.find({ where: { taskId: In(idSet) }, relations: ['user'] }),
      this.checklistItemRepo.find({ where: { taskId: In(idSet) } }),
      this.commentRepo.find({ where: { taskId: In(idSet), deletedAt: IsNull() } }),
      this.dependencyEdgeRepo.find({ where: { taskId: In(idSet) } }),
      this.taskLabelRepo.find({ where: { taskId: In(idSet) }, relations: ['label'] }),
      this.viewMetadataRepo.find({ where: { taskId: In(idSet) } }),
    ]);

    // Group sub-resources by taskId for O(1) lookup during assembly
    const assigneeMap        = new Map<string, typeof assignees>();
    const checklistMap       = new Map<string, typeof checklistItems>();
    const commentMap         = new Map<string, typeof comments>();
    const depMap             = new Map<string, typeof dependencyEdges>();
    const labelMap           = new Map<string, typeof labels>();
    const viewMetaMap        = new Map<string, typeof viewMetadataEntries>();

    for (const r of assignees)           { const a = assigneeMap.get(r.taskId) ?? []; a.push(r); assigneeMap.set(r.taskId, a); }
    for (const r of checklistItems)      { const a = checklistMap.get(r.taskId) ?? []; a.push(r); checklistMap.set(r.taskId, a); }
    for (const r of comments)            { const a = commentMap.get(r.taskId) ?? []; a.push(r); commentMap.set(r.taskId, a); }
    for (const r of dependencyEdges)     { const a = depMap.get(r.taskId) ?? []; a.push(r); depMap.set(r.taskId, a); }
    for (const r of labels)              { const a = labelMap.get(r.taskId) ?? []; a.push(r); labelMap.set(r.taskId, a); }
    for (const r of viewMetadataEntries) { const a = viewMetaMap.get(r.taskId) ?? []; a.push(r); viewMetaMap.set(r.taskId, a); }

    // Stitch sub-resources onto task objects in-memory (zero extra queries)
    for (const task of tasks) {
      task.assignees           = assigneeMap.get(task.id)        ?? [];
      task.checklistItems      = checklistMap.get(task.id)       ?? [];
      task.comments            = commentMap.get(task.id)         ?? [];
      task.dependencyEdges     = depMap.get(task.id)             ?? [];
      task.labels              = labelMap.get(task.id)           ?? [];
      task.viewMetadataEntries = viewMetaMap.get(task.id)        ?? [];
    }

    // Wave 2: child counts + roleContext — both fire in parallel.
    //
    // commentCount is derived from the already-loaded comments (free, no extra query).
    // childCount needs a GROUP BY query (children are not loaded in this path).
    // roleContext needs assignee userIds from wave 1 (now assembled), so it must come after.
    // Both are independent of each other, so we fire them together.
    const userIds = tasks.flatMap((t) =>
      [t.reporteeUserId, ...(t.assignees ?? []).map((a) => a.userId)].filter((v): v is string => Boolean(v)),
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

    const childCountMap = new Map(childRows.map((r) => [r.parentTaskId, Number(r.cnt)]));

    return tasks.map((task) =>
      this.toTaskListItemSerializer(
        this.membersSvc.buildTaskReadModel(task, roleContext, {
          childCount:   childCountMap.get(task.id) ?? 0,
          commentCount: commentMap.get(task.id)?.length ?? 0,  // in-memory, zero extra query
        }),
      ),
    );
  }
}
