import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { In, IsNull, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationType } from 'src/notifications/entities/notification.entity';
import {
  Project,
  ProjectActivityLog,
  ProjectInvite,
  ProjectMembership,
  ProjectRole,
} from 'src/projects/entities';
import { InviteStatus } from 'src/projects/entities/project-invite.entity';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import type { ProjectPermissionMatrix } from 'src/projects/types/project-permission-matrix.type';
import { User } from 'src/users/entities';
import { Task, TaskLabel, TaskWatcher } from '../entities';
import { AddLabelDto, AddWatcherDto } from '../dtos';
import { ProjectLabel } from '../project-config';
import {
  INVALID_TASK_ASSIGNED_MEMBERS,
  INVALID_TASK_ASSIGNEES,
  INVALID_TASK_LABEL,
  INVALID_TASK_REPORTEE,
  INVALID_TASK_WATCHER,
  TASK_LABEL_ALREADY_ADDED,
  TASK_WATCHER_ALREADY_WATCHING,
  TASK_WATCHER_NOT_FOUND,
} from '../messages';
import {
  TaskLabelDetailSerializer,
  TaskWatcherDetailSerializer,
} from '../serializers';
import { NotFoundException } from '@nestjs/common';

// ── Shared read-model types ───────────────────────────────────────────────────

export interface TaskCounts {
  childCount: number;
  commentCount: number;
}

export interface ProjectRoleContext {
  projectRoleId: string | null;
  projectRole: {
    id: string;
    name: string;
    slug: string;
    status: boolean;
    permissions: ProjectPermissionMatrix;
  } | null;
}

@Injectable()
export class TaskMembersService {
  constructor(
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
    @InjectRepository(ProjectRole)
    private readonly projectRoleRepo: Repository<ProjectRole>,
    @InjectRepository(ProjectInvite)
    private readonly projectInviteRepo: Repository<ProjectInvite>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ProjectActivityLog)
    private readonly projectActivityLogRepo: Repository<ProjectActivityLog>,
    @InjectRepository(TaskWatcher)
    private readonly taskWatcherRepo: Repository<TaskWatcher>,
    @InjectRepository(TaskLabel)
    private readonly taskLabelRepo: Repository<TaskLabel>,
    @InjectRepository(ProjectLabel)
    private readonly projectLabelRepo: Repository<ProjectLabel>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Serializers ───────────────────────────────────────────────────────────

  private serializeWatcher(w: Partial<TaskWatcher>): TaskWatcherDetailSerializer {
    return plainToInstance(TaskWatcherDetailSerializer, w, { excludeExtraneousValues: true });
  }

  private serializeLabel(l: Partial<TaskLabel>): TaskLabelDetailSerializer {
    return plainToInstance(TaskLabelDetailSerializer, l, { excludeExtraneousValues: true });
  }

  // ── Private invite helpers ────────────────────────────────────────────────

  private generateInviteToken(): string {
    return randomBytes(48).toString('hex');
  }

  private inviteExpiresAt(): Date {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  // ── Member validation ─────────────────────────────────────────────────────

  async ensureAssigneeUsers(projectId: string, userIds: string[]): Promise<User[]> {
    if (!userIds.length) return [];

    const memberships = await this.membershipRepo.find({
      where: { projectId, status: MembershipStatus.ACTIVE, userId: In(userIds) },
      relations: ['user'],
    });

    const uniqueUsers = new Map<string, User>();
    for (const m of memberships) {
      if (m.user) uniqueUsers.set(m.userId, m.user);
    }

    if (uniqueUsers.size !== new Set(userIds).size) {
      throw new BadRequestException(INVALID_TASK_ASSIGNEES);
    }

    return userIds.map((id) => uniqueUsers.get(id)!);
  }

  async ensureAssignedMembers(
    projectId: string,
    assignedMembers: Array<{ userId: string; projectRoleId: string }>,
    tx: import('typeorm').EntityManager,
    actorUser: User,
  ): Promise<{ user: User; userId: string }[]> {
    if (!assignedMembers.length) throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);

    const uniqueUserIds = [...new Set(assignedMembers.map((m) => m.userId))];
    if (uniqueUserIds.length !== assignedMembers.length) {
      throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);
    }

    const uniqueRoleIds = [...new Set(assignedMembers.map((m) => m.projectRoleId))];
    const roles = await tx.find(ProjectRole, { where: { id: In(uniqueRoleIds), projectId } });
    const roleMap = new Map(roles.map((r) => [r.id, r]));
    for (const member of assignedMembers) {
      if (!roleMap.has(member.projectRoleId)) throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);
    }

    const [memberships, users] = await Promise.all([
      tx.find(ProjectMembership, { where: { projectId, userId: In(uniqueUserIds) }, relations: ['user'] }),
      tx.find(User, { where: { id: In(uniqueUserIds) } }),
    ]);

    const membershipMap = new Map(memberships.map((m) => [m.userId, m]));
    const userMap = new Map(users.map((u) => [u.id, u]));
    const project = await tx.findOneOrFail(Project, { where: { id: projectId } });

    const result: { user: User; userId: string }[] = [];

    for (const member of assignedMembers) {
      const user = userMap.get(member.userId);
      if (!user) throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);

      const membership = membershipMap.get(member.userId);

      if (membership && membership.status === MembershipStatus.ACTIVE) {
        if (membership.projectRoleId !== member.projectRoleId) {
          throw new BadRequestException(INVALID_TASK_ASSIGNED_MEMBERS);
        }
        result.push({ user, userId: user.id });
        continue;
      }

      const existingPendingInvite = await tx.findOne(ProjectInvite, {
        where: { projectId, inviteeUserId: user.id, status: InviteStatus.PENDING },
      });

      if (!existingPendingInvite) {
        const role = roleMap.get(member.projectRoleId)!;
        await tx.save(
          tx.create(ProjectInvite, {
            project,
            projectId,
            inviterUser: actorUser,
            inviterUserId: actorUser.id,
            inviteeUser: user,
            inviteeUserId: user.id,
            projectRole: role,
            projectRoleId: role.id,
            token: this.generateInviteToken(),
            status: InviteStatus.PENDING,
            expiresAt: this.inviteExpiresAt(),
            acceptedAt: null,
            message: null,
          }),
        );

        void this.notificationsService
          .createNotification({
            userId: user.id,
            type: NotificationType.INVITE_RECEIVED,
            title: `You've been invited to join a project`,
            body: `${actorUser.firstName} ${actorUser.lastName} assigned you to a task and invited you to join the project.`,
            meta: { projectId, projectRoleId: member.projectRoleId },
          })
          .catch(() => void 0);
      }

      result.push({ user, userId: user.id });
    }

    return result;
  }

  async ensureReporteeMember(
    projectId: string,
    reportee: { userId: string; projectRoleId: string },
  ): Promise<ProjectMembership> {
    const membership = await this.membershipRepo.findOne({
      where: { projectId, userId: reportee.userId, status: MembershipStatus.ACTIVE },
      relations: ['user', 'projectRole'],
    });

    if (!membership || membership.projectRoleId !== reportee.projectRoleId) {
      throw new BadRequestException(INVALID_TASK_REPORTEE);
    }

    return membership;
  }

  // ── Role context + read model ─────────────────────────────────────────────

  async loadProjectRoleContextMap(
    projectId: string,
    userIds: string[],
  ): Promise<Map<string, ProjectRoleContext>> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (!uniqueIds.length) return new Map();

    const memberships = await this.membershipRepo.find({
      where: { projectId, status: MembershipStatus.ACTIVE, userId: In(uniqueIds) },
      relations: ['projectRole'],
    });

    return new Map(
      memberships.map((m) => [
        m.userId,
        {
          projectRoleId: m.projectRoleId ?? null,
          projectRole: m.projectRole
            ? { id: m.projectRole.id, name: m.projectRole.name, slug: m.projectRole.slug, status: m.projectRole.status, permissions: m.projectRole.permissions }
            : null,
        },
      ]),
    );
  }

  buildTaskReadModel(
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
    const reporteeRoleContext = reporteeUser ? membershipRoleContext.get(reporteeUser.id) : undefined;

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

  async computeCounts(
    taskId: string,
    taskCommentRepo: Repository<import('../entities').TaskComment>,
  ): Promise<TaskCounts> {
    const [childCount, commentCount] = await Promise.all([
      this.taskRepo.count({ where: { parentTaskId: taskId, deletedAt: IsNull() } }),
      taskCommentRepo.count({ where: { taskId, deletedAt: IsNull() } }),
    ]);
    return { childCount, commentCount };
  }

  // ── Watchers ──────────────────────────────────────────────────────────────

  async listWatchers(taskId: string): Promise<TaskWatcherDetailSerializer[]> {
    const watchers = await this.taskWatcherRepo.find({
      where: { taskId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
    return watchers.map((w) => this.serializeWatcher(w));
  }

  async addWatcher(task: Task, dto: AddWatcherDto, projectId: string): Promise<TaskWatcherDetailSerializer> {
    const membership = await this.membershipRepo.findOne({
      where: { projectId, userId: dto.userId, status: MembershipStatus.ACTIVE },
      relations: ['user'],
    });
    if (!membership) throw new BadRequestException(INVALID_TASK_WATCHER);

    const existing = await this.taskWatcherRepo.findOne({ where: { taskId: task.id, userId: dto.userId } });
    if (existing) throw new BadRequestException(TASK_WATCHER_ALREADY_WATCHING);

    const watcher = await this.taskWatcherRepo.save(
      this.taskWatcherRepo.create({ task, taskId: task.id, user: membership.user, userId: dto.userId }),
    );

    return this.serializeWatcher({ ...watcher, user: membership.user });
  }

  async removeWatcher(taskId: string, watcherId: string): Promise<{ id: string; success: true }> {
    const w = await this.taskWatcherRepo.findOne({ where: { id: watcherId, taskId }, relations: ['user'] });
    if (!w) throw new NotFoundException(TASK_WATCHER_NOT_FOUND);
    await this.taskWatcherRepo.remove(w);
    return { id: watcherId, success: true };
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  async listLabels(taskId: string): Promise<TaskLabelDetailSerializer[]> {
    const labels = await this.taskLabelRepo.find({
      where: { taskId },
      relations: ['label'],
      order: { id: 'ASC' },
    });
    return labels.map((l) => this.serializeLabel(l));
  }

  async addLabel(task: Task, dto: AddLabelDto, projectId: string): Promise<TaskLabelDetailSerializer> {
    const projectLabel = await this.projectLabelRepo.findOne({ where: { id: dto.labelId, projectId } });
    if (!projectLabel) throw new BadRequestException(INVALID_TASK_LABEL);

    const existing = await this.taskLabelRepo.findOne({ where: { taskId: task.id, labelId: dto.labelId }, relations: ['label'] });
    if (existing) throw new BadRequestException(TASK_LABEL_ALREADY_ADDED);

    const tl = await this.taskLabelRepo.save(
      this.taskLabelRepo.create({ task, taskId: task.id, label: projectLabel, labelId: projectLabel.id }),
    );

    return this.serializeLabel({ ...tl, label: projectLabel });
  }

  async removeLabel(taskId: string, taskLabelId: string): Promise<{ id: string; success: true }> {
    const tl = await this.taskLabelRepo.findOne({ where: { id: taskLabelId, taskId }, relations: ['label'] });
    if (!tl) throw new NotFoundException(INVALID_TASK_LABEL);
    await this.taskLabelRepo.remove(tl);
    return { id: taskLabelId, success: true };
  }
}
