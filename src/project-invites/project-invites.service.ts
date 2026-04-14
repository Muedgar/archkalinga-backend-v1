import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';

import { RequestUser } from 'src/auth/types';
import {
  ProjectInvite,
  ProjectMembership,
  ProjectActionType,
  ProjectActivityLog,
  ProjectRole,
} from 'src/projects/entities';
import {
  InviteStatus,
  InviteTargetType,
} from 'src/projects/entities/project-invite.entity';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import { Project } from 'src/projects/entities/project.entity';
import { Task } from 'src/tasks/entities/task.entity';
import {
  TaskAssignee,
  AssignmentRole,
} from 'src/tasks/entities/task-assignee.entity';
import { User } from 'src/users/entities/user.entity';

import { CreateProjectInviteDto } from './dtos/create-project-invite.dto';
import { InviteFiltersDto } from './dtos/invite-filters.dto';
import { ProjectInviteSerializer } from './serializers/project-invite.serializer';
import {
  INVITE_ALREADY_MEMBER,
  INVITE_DUPLICATE,
  INVITE_FORBIDDEN,
  INVITE_NOT_FOUND,
  INVITE_NOT_PENDING,
  INVITE_PROJECT_NOT_FOUND,
  INVITE_PROJECT_ROLE_INVALID,
  INVITE_PROJECT_ROLE_UNAVAILABLE,
  INVITE_SUBTASK_INVALID,
  INVITE_TASK_NOT_FOUND,
  INVITE_TOKEN_INVALID,
  INVITEE_ACCOUNT_NOT_FOUND,
} from './messages';

// Token TTL: 7 days
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ProjectInvitesService {
  constructor(
    @InjectRepository(ProjectInvite)
    private readonly inviteRepo: Repository<ProjectInvite>,

    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
    @InjectRepository(ProjectRole)
    private readonly projectRoleRepo: Repository<ProjectRole>,

    // ProjectActivityLog is registered in forFeature but logs are always written
    // via the transaction entity manager — no direct repo injection needed.

    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,

    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,

    @InjectRepository(TaskAssignee)
    private readonly taskAssigneeRepo: Repository<TaskAssignee>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private toSerializer(invite: ProjectInvite): ProjectInviteSerializer {
    return plainToInstance(ProjectInviteSerializer, invite, {
      excludeExtraneousValues: true,
    });
  }

  private generateToken(): string {
    return randomBytes(48).toString('hex'); // 96 hex chars
  }

  private expiresAt(): Date {
    return new Date(Date.now() + INVITE_TTL_MS);
  }

  /**
   * Verify the requesting user has an ACTIVE membership in the project.
   * Admins bypass the check.
   */
  private async requireProjectMembership(
    projectId: string,
    requestUser: RequestUser,
  ): Promise<void> {
    const isAdmin = (requestUser as any).role?.slug === 'admin';
    if (isAdmin) return;

    const membership = await this.membershipRepo.findOne({
      where: {
        projectId,
        userId: requestUser.id,
        status: MembershipStatus.ACTIVE,
      },
    });
    if (!membership) throw new ForbiddenException(INVITE_FORBIDDEN);
  }

  // ---------------------------------------------------------------------------
  // Create invite
  // ---------------------------------------------------------------------------

  async createInvite(
    dto: CreateProjectInviteDto,
    requestUser: RequestUser,
  ): Promise<ProjectInviteSerializer> {
    await this.requireProjectMembership(dto.projectId, requestUser);

    // 1. Load project to get its name and verify org
    const project = await this.projectRepo.findOne({
      where: { id: dto.projectId, organizationId: requestUser.organizationId },
    });
    if (!project) throw new NotFoundException(INVITE_PROJECT_NOT_FOUND);

    const projectRole = await this.projectRoleRepo.findOne({
      where: { id: dto.projectRoleId, projectId: dto.projectId },
    });
    if (!projectRole || !projectRole.status) {
      throw new BadRequestException(INVITE_PROJECT_ROLE_INVALID);
    }

    // 2. Verify invitee is NOT already an active member
    const existingByEmail = await this.userRepo.findOne({
      where: { email: dto.inviteeEmail.toLowerCase() },
    });
    if (existingByEmail) {
      const activeMembership = await this.membershipRepo.findOne({
        where: {
          projectId: dto.projectId,
          userId: existingByEmail.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      if (activeMembership) throw new ConflictException(INVITE_ALREADY_MEMBER);
    }

    // 3. Validate task context
    let resolvedTask: Task | null = null;
    let resolvedSubtask: Task | null = null;
    let targetType = InviteTargetType.PROJECT;
    let targetName: string | null = null;

    if (dto.taskId) {
      resolvedTask = await this.taskRepo.findOne({
        where: {
          id: dto.taskId,
          projectId: dto.projectId,
          deletedAt: IsNull(),
        },
      });
      if (!resolvedTask) throw new NotFoundException(INVITE_TASK_NOT_FOUND);
      targetType = InviteTargetType.TASK;
      targetName = resolvedTask.title;

      if (dto.subtaskId) {
        resolvedSubtask = await this.taskRepo.findOne({
          where: {
            id: dto.subtaskId,
            projectId: dto.projectId,
            parentTaskId: dto.taskId,
            deletedAt: IsNull(),
          },
        });
        if (!resolvedSubtask)
          throw new NotFoundException(INVITE_SUBTASK_INVALID);
        targetType = InviteTargetType.SUBTASK;
        targetName = resolvedSubtask.title;
      }
    }

    // 4. Duplicate check: block active PENDING invite for same email + same target
    const duplicateQb = this.inviteRepo
      .createQueryBuilder('inv')
      .where('inv.projectId = :projectId', { projectId: dto.projectId })
      .andWhere('LOWER(inv.inviteeEmail) = LOWER(:email)', {
        email: dto.inviteeEmail,
      })
      .andWhere('inv.status = :status', { status: InviteStatus.PENDING });

    if (dto.taskId) {
      duplicateQb.andWhere('inv.taskId = :taskId', { taskId: dto.taskId });
      if (dto.subtaskId) {
        duplicateQb.andWhere('inv.subtaskId = :subtaskId', {
          subtaskId: dto.subtaskId,
        });
      } else {
        duplicateQb.andWhere('inv.subtaskId IS NULL');
      }
    } else {
      duplicateQb.andWhere('inv.taskId IS NULL');
    }

    const duplicate = await duplicateQb.getOne();
    if (duplicate) throw new ConflictException(INVITE_DUPLICATE);

    // 5. Load inviter user record
    const inviterUser = await this.userRepo.findOneOrFail({
      where: { id: requestUser.id },
    });

    // 6. Create the invite inside a transaction
    const invite = await this.inviteRepo.manager.transaction(async (tx) => {
      const newInvite = tx.create(ProjectInvite, {
        project,
        projectId: dto.projectId,
        projectName: project.title,
        inviterUser,
        inviterUserId: requestUser.id,
        inviteeEmail: dto.inviteeEmail.toLowerCase(),
        inviteeUserId: existingByEmail?.id ?? null,
        projectRole,
        projectRoleId: projectRole.id,
        token: this.generateToken(),
        status: InviteStatus.PENDING,
        expiresAt: this.expiresAt(),
        acceptedAt: null,
        taskId: dto.taskId ?? null,
        subtaskId: dto.subtaskId ?? null,
        targetType,
        targetName,
        message: dto.message ?? null,
        autoAssignOnAccept: dto.autoAssignOnAccept ?? false,
      });
      const saved = await tx.save(newInvite);

      // Activity log
      await tx.save(
        tx.create(ProjectActivityLog, {
          project,
          projectId: dto.projectId,
          user: inviterUser,
          userId: requestUser.id,
          taskId: dto.taskId ?? null,
          actionType: ProjectActionType.INVITE_SENT,
          actionMeta: {
            inviteeEmail: dto.inviteeEmail,
            projectRoleId: projectRole.id,
            projectRoleSlug: projectRole.slug,
            targetType,
            taskId: dto.taskId ?? null,
            subtaskId: dto.subtaskId ?? null,
          },
        }),
      );

      return saved;
    });

    // Reload with inviterUser relation for serialization
    const full = await this.inviteRepo.findOne({
      where: { id: invite.id },
      relations: ['inviterUser', 'projectRole'],
    });
    return this.toSerializer(full!);
  }

  // ---------------------------------------------------------------------------
  // List invites for a project (with optional task/subtask filter)
  // ---------------------------------------------------------------------------

  async listInvites(
    projectId: string,
    filters: InviteFiltersDto,
    requestUser: RequestUser,
  ): Promise<{ items: ProjectInviteSerializer[]; count: number }> {
    await this.requireProjectMembership(projectId, requestUser);

    const { page, limit, taskId, subtaskId, status } = filters;

    const qb = this.inviteRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.inviterUser', 'inviterUser')
      .leftJoinAndSelect('inv.projectRole', 'projectRole')
      .where('inv.projectId = :projectId', { projectId })
      .orderBy('inv.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (taskId) {
      qb.andWhere('inv.taskId = :taskId', { taskId });
      if (subtaskId) {
        qb.andWhere('inv.subtaskId = :subtaskId', { subtaskId });
      }
    }

    if (status) {
      qb.andWhere('inv.status = :status', { status });
    }

    const [invites, count] = await qb.getManyAndCount();

    return {
      items: invites.map((i) => this.toSerializer(i)),
      count,
    };
  }

  // ---------------------------------------------------------------------------
  // Resend invite (generates a new token + extends expiry)
  // ---------------------------------------------------------------------------

  async resendInvite(
    inviteId: string,
    requestUser: RequestUser,
  ): Promise<ProjectInviteSerializer> {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
      relations: ['inviterUser', 'projectRole'],
    });
    if (!invite) throw new NotFoundException(INVITE_NOT_FOUND);

    await this.requireProjectMembership(invite.projectId, requestUser);

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException(INVITE_NOT_PENDING);
    }

    invite.token = this.generateToken();
    invite.expiresAt = this.expiresAt();
    await this.inviteRepo.save(invite);

    return this.toSerializer(invite);
  }

  // ---------------------------------------------------------------------------
  // Cancel invite
  // ---------------------------------------------------------------------------

  async cancelInvite(
    inviteId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; canceled: true }> {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
    });
    if (!invite) throw new NotFoundException(INVITE_NOT_FOUND);

    await this.requireProjectMembership(invite.projectId, requestUser);

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException(INVITE_NOT_PENDING);
    }

    invite.status = InviteStatus.REVOKED;
    await this.inviteRepo.save(invite);

    return { id: inviteId, canceled: true };
  }

  // ---------------------------------------------------------------------------
  // Accept invite by token
  // ---------------------------------------------------------------------------

  /**
   * Accept an invite by its one-time token.
   *
   * Steps:
   *  1. Validate token — must be PENDING and not expired.
   *  2. Resolve or create project membership for the invitee.
   *  3. If autoAssignOnAccept, add the user as a task/subtask assignee.
   *  4. Mark the invite ACCEPTED.
   *  5. Return redirect context { projectId, taskId, subtaskId } for deep-linking.
   */
  async acceptInvite(token: string): Promise<{
    projectId: string;
    taskId: string | null;
    subtaskId: string | null;
    message: string | null;
    inviteId: string;
    membership: {
      id: string;
      status: MembershipStatus;
      projectRoleId: string;
      projectRole: {
        id: string;
        name: string;
        slug: string;
        status: boolean;
        isSystem: boolean;
        isProtected: boolean;
        permissions: Record<string, Record<string, boolean>>;
      } | null;
    };
  }> {
    const invite = await this.inviteRepo.findOne({
      where: { token },
      relations: ['project', 'inviterUser', 'projectRole'],
    });

    if (
      !invite ||
      invite.status !== InviteStatus.PENDING ||
      invite.expiresAt < new Date()
    ) {
      // Mark as expired if time has passed but status not yet updated
      if (
        invite &&
        invite.status === InviteStatus.PENDING &&
        invite.expiresAt < new Date()
      ) {
        invite.status = InviteStatus.EXPIRED;
        await this.inviteRepo.save(invite);
      }
      throw new BadRequestException(INVITE_TOKEN_INVALID);
    }

    if (
      !invite.projectRole ||
      invite.projectRole.projectId !== invite.projectId ||
      !invite.projectRole.status
    ) {
      throw new BadRequestException(INVITE_PROJECT_ROLE_UNAVAILABLE);
    }

    // Find the invitee user by email
    const inviteeUser = await this.userRepo.findOne({
      where: { email: invite.inviteeEmail },
    });
    if (!inviteeUser) {
      // User hasn't signed up yet — return context so the frontend
      // can route them to registration with the token pre-filled.
      throw new BadRequestException(INVITEE_ACCOUNT_NOT_FOUND);
    }

    const result = await this.inviteRepo.manager.transaction(async (tx) => {
      // 1. Upsert project membership
      let membership = await tx.findOne(ProjectMembership, {
        where: {
          projectId: invite.projectId,
          userId: inviteeUser.id,
        },
        relations: ['projectRole'],
      });

      if (!membership) {
        membership = tx.create(ProjectMembership, {
          project: invite.project,
          projectId: invite.projectId,
          user: inviteeUser,
          userId: inviteeUser.id,
          projectRole: invite.projectRole,
          projectRoleId: invite.projectRoleId,
          status: MembershipStatus.ACTIVE,
          invitedByUser: invite.inviterUser ?? null,
          invitedByUserId: invite.inviterUserId,
          inviteId: invite.id,
          joinedAt: new Date(),
          removedAt: null,
        });
        membership = await tx.save(membership);
      } else if (membership.status === MembershipStatus.REMOVED) {
        // Re-activate a previously removed membership
        membership.status = MembershipStatus.ACTIVE;
        membership.joinedAt = new Date();
        membership.removedAt = null;
        membership.invitedByUser = invite.inviterUser ?? null;
        membership.invitedByUserId = invite.inviterUserId;
        membership.inviteId = invite.id;
        membership.projectRole = invite.projectRole;
        membership.projectRoleId = invite.projectRoleId;
        membership = await tx.save(membership);
      } else if (membership.projectRoleId !== invite.projectRoleId) {
        membership.invitedByUser = invite.inviterUser ?? null;
        membership.invitedByUserId = invite.inviterUserId;
        membership.inviteId = invite.id;
        membership.projectRole = invite.projectRole;
        membership.projectRoleId = invite.projectRoleId;
        membership = await tx.save(membership);
      }

      // 2. Auto-assign to task/subtask when requested
      if (invite.autoAssignOnAccept) {
        const assignTarget = invite.subtaskId ?? invite.taskId;
        if (assignTarget) {
          const task = await tx.findOne(Task, {
            where: { id: assignTarget, deletedAt: IsNull() },
          });
          if (task) {
            const existing = await tx.findOne(TaskAssignee, {
              where: { taskId: assignTarget, userId: inviteeUser.id },
            });
            if (!existing) {
              await tx.save(
                tx.create(TaskAssignee, {
                  task,
                  taskId: assignTarget,
                  user: inviteeUser,
                  userId: inviteeUser.id,
                  assignmentRole: AssignmentRole.CONTRIBUTOR,
                }),
              );
            }
          }
        }
      }

      // 3. Mark invite as accepted
      invite.status = InviteStatus.ACCEPTED;
      invite.acceptedAt = new Date();
      invite.inviteeUserId = inviteeUser.id;
      await tx.save(invite);

      // 4. Activity log
      await tx.save(
        tx.create(ProjectActivityLog, {
          project: invite.project,
          projectId: invite.projectId,
          user: inviteeUser,
          userId: inviteeUser.id,
          taskId: invite.taskId,
          actionType: ProjectActionType.INVITE_ACCEPTED,
          actionMeta: {
            inviteId: invite.id,
            membershipId: membership.id,
            projectRoleId: invite.projectRoleId,
            projectRoleName: invite.projectRole.name,
            projectRoleSlug: invite.projectRole.slug,
            targetType: invite.targetType,
            taskId: invite.taskId,
            subtaskId: invite.subtaskId,
          },
        }),
      );

      return membership;
    });

    return {
      projectId: invite.projectId,
      taskId: invite.taskId,
      subtaskId: invite.subtaskId,
      message: invite.message,
      inviteId: invite.id,
      membership: {
        id: result.id,
        status: result.status,
        projectRoleId: result.projectRoleId,
        projectRole: result.projectRole
          ? {
              id: result.projectRole.id,
              name: result.projectRole.name,
              slug: result.projectRole.slug,
              status: result.projectRole.status,
              isSystem: result.projectRole.isSystem,
              isProtected: result.projectRole.isProtected,
              permissions: result.projectRole.permissions,
            }
          : invite.projectRole
            ? {
                id: invite.projectRole.id,
                name: invite.projectRole.name,
                slug: invite.projectRole.slug,
                status: invite.projectRole.status,
                isSystem: invite.projectRole.isSystem,
                isProtected: invite.projectRole.isProtected,
                permissions: invite.projectRole.permissions,
              }
            : null,
      },
    };
  }
}
