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
import { Task, TaskComment } from '../entities';
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
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(TASK_PROJECT_NOT_FOUND);

    if (this.isAdmin(requestUser)) return { project, membership: null };

    const membership = await this.membershipRepo.findOne({
      where: { projectId, userId: requestUser.id, status: MembershipStatus.ACTIVE },
      relations: ['projectRole'],
    });

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
    const task = await this.taskRepo.findOne({
      where: { id: taskId, projectId, deletedAt: IsNull() },
      relations: [
        'assignees', 'assignees.user', 'checklistItems', 'comments',
        'dependencyEdges', 'viewMetadataEntries', 'reporteeUser',
        'status', 'priority', 'taskType', 'severity',
        'labels', 'labels.label',
      ],
    });
    if (!task) throw new NotFoundException(TASK_NOT_FOUND);
    return task;
  }

  async loadTasksForList(taskIds: string[], projectId: string): Promise<TaskListItemSerializer[]> {
    if (!taskIds.length) return [];

    const tasks = await this.taskRepo.find({
      where: { id: In(taskIds), projectId, deletedAt: IsNull() },
      relations: [
        'assignees', 'assignees.user', 'checklistItems', 'comments',
        'dependencyEdges', 'viewMetadataEntries', 'reporteeUser',
        'status', 'priority', 'taskType', 'severity',
        'labels', 'labels.label',
      ],
      order: { createdAt: 'DESC' },
    });

    const counts = await Promise.all(
      tasks.map(async (t) => ({ taskId: t.id, ...(await this.membersSvc.computeCounts(t.id, this.commentRepo)) })),
    );
    const countMap = new Map(counts.map((e) => [e.taskId, e]));

    const roleContext = await this.membersSvc.loadProjectRoleContextMap(
      projectId,
      tasks.flatMap((t) =>
        [t.reporteeUserId, ...(t.assignees ?? []).map((a) => a.userId)].filter((v): v is string => Boolean(v)),
      ),
    );

    return tasks.map((task) =>
      this.toTaskListItemSerializer(
        this.membersSvc.buildTaskReadModel(task, roleContext, {
          childCount: countMap.get(task.id)?.childCount ?? 0,
          commentCount: countMap.get(task.id)?.commentCount ?? 0,
        }),
      ),
    );
  }
}
