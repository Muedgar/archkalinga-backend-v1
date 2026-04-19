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
import { Repository } from 'typeorm';

import { RequestUser } from 'src/auth/types';
import {
  ProjectInvite,
  ProjectMembership,
  ProjectActionType,
  ProjectActivityLog,
  ProjectRole,
} from 'src/projects/entities';
import { InviteStatus } from 'src/projects/entities/project-invite.entity';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import { Project } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities/user.entity';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { WorkspaceMember, WorkspaceMemberStatus } from 'src/workspaces/entities/workspace-member.entity';
import { WorkspaceRole } from 'src/roles/roles.entity';
import { EMPTY_ACCESS_MATRIX } from 'src/roles/types/permission-matrix.type';
import { ProjectPermissionMatrix } from 'src/projects/types/project-permission-matrix.type';
import {
  NotificationsService,
} from 'src/notifications/notifications.service';
import { NotificationType } from 'src/notifications/entities/notification.entity';

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
  INVITE_TOKEN_INVALID,
  INVITEE_ACCOUNT_NOT_FOUND,
} from './messages';

const INVITE_NOT_YOURS = 'This invite was not sent to you';

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

    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(WorkspaceMember)
    private readonly workspaceMemberRepo: Repository<WorkspaceMember>,

    @InjectRepository(WorkspaceRole)
    private readonly workspaceRoleRepo: Repository<WorkspaceRole>,

    private readonly notificationsService: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensure the invitee has an ACTIVE workspace membership after accepting a
   * project invite.
   *
   * Construction SaaS context: a subcontractor or client can be invited to a
   * specific project without being a full workspace member up front.  Accepting
   * the invite is the moment they gain workspace access — as a "Guest" with the
   * minimum permissions needed to see their project and work inside it.
   *
   * Guest workspace role permissions (view-only across project domains):
   *  - projectManagement.view  → can list/open projects they belong to
   *  - task/doc/CR management  → view-only (project-role matrix governs deeper access)
   *  - user/role/template mgmt → all false (workspace-admin actions only)
   *
   * The role is upserted once per workspace so the first accept creates it;
   * subsequent accepts for the same workspace find and reuse it.
   *
   * Must be called inside the same transaction (tx) as the ProjectMembership
   * save so the whole operation stays atomic.
   */
  private async ensureWorkspaceMembership(
    tx: import('typeorm').EntityManager,
    inviteeUser: User,
    workspaceId: string,
    inviterUser: User,
  ): Promise<void> {
    // Already a member of this workspace? Nothing to do.
    const existing = await tx.findOne(WorkspaceMember, {
      where: { workspaceId, userId: inviteeUser.id },
    });
    if (existing) {
      // Re-activate if they were previously removed
      if (existing.status === WorkspaceMemberStatus.REMOVED) {
        existing.status   = WorkspaceMemberStatus.ACTIVE;
        existing.joinedAt = new Date();
        await tx.save(existing);
      }
      return;
    }

    // Load the workspace entity — needed to satisfy the @ManyToOne relation on
    // both WorkspaceRole and WorkspaceMember (TypeORM writes the FK column
    // workspace_id from the relation object, not from the scalar workspaceId).
    const workspace = await tx.findOneOrFail(Workspace, { where: { id: workspaceId } });

    // Look up (or lazily create) the Guest workspace role for this workspace
    let guestRole = await tx.findOne(WorkspaceRole, {
      where: { workspaceId, slug: 'guest' },
    });

    if (!guestRole) {
      guestRole = await tx.save(
        tx.create(WorkspaceRole, {
          workspace,    // relation object → writes workspace_id FK
          workspaceId,  // scalar accessor
          name: 'Guest',
          slug: 'guest',
          status: true,
          isSystem: true,
          permissions: {
            ...EMPTY_ACCESS_MATRIX,
            projectManagement:       { create: false, update: false, view: true,  delete: false },
            taskManagement:          { create: false, update: false, view: true,  delete: false },
            documentManagement:      { create: false, update: false, view: true,  delete: false },
            changeRequestManagement: { create: false, update: false, view: true,  delete: false },
          },
        }),
      );
    }

    // Create the workspace membership
    await tx.save(
      tx.create(WorkspaceMember, {
        workspace,       // relation object → writes workspace_id FK
        workspaceId,
        user:   inviteeUser,   // relation object → writes user_id FK
        userId: inviteeUser.id,
        workspaceRole:   guestRole,
        workspaceRoleId: guestRole.id,
        status:          WorkspaceMemberStatus.ACTIVE,
        joinedAt:        new Date(),
        invitedByUser:   inviterUser,
        invitedByUserId: inviterUser.id,
      }),
    );
  }

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

    // 1. Verify project exists
    const project = await this.projectRepo.findOne({
      where: { id: dto.projectId },
    });
    if (!project) throw new NotFoundException(INVITE_PROJECT_NOT_FOUND);

    // 2. Verify the project role belongs to this project and is active
    const projectRole = await this.projectRoleRepo.findOne({
      where: { id: dto.projectRoleId, projectId: dto.projectId },
    });
    if (!projectRole || !projectRole.status) {
      throw new BadRequestException(INVITE_PROJECT_ROLE_INVALID);
    }

    // 3. Verify invitee account exists
    const inviteeUser = await this.userRepo.findOne({
      where: { id: dto.inviteeUserId },
    });
    if (!inviteeUser) throw new NotFoundException(INVITEE_ACCOUNT_NOT_FOUND);

    // 4. Guard: invitee must not already be an active project member
    const activeMembership = await this.membershipRepo.findOne({
      where: {
        projectId: dto.projectId,
        userId: inviteeUser.id,
        status: MembershipStatus.ACTIVE,
      },
    });
    if (activeMembership) throw new ConflictException(INVITE_ALREADY_MEMBER);

    // 5. Guard: no duplicate PENDING invite (DB partial unique index backs this up)
    const duplicate = await this.inviteRepo.findOne({
      where: {
        projectId: dto.projectId,
        inviteeUserId: inviteeUser.id,
        status: InviteStatus.PENDING,
      },
    });
    if (duplicate) throw new ConflictException(INVITE_DUPLICATE);

    // 6. Load inviter for activity log
    const inviterUser = await this.userRepo.findOneOrFail({
      where: { id: requestUser.id },
    });

    // 7. Persist invite + activity log in a transaction
    const invite = await this.inviteRepo.manager.transaction(async (tx) => {
      const newInvite = tx.create(ProjectInvite, {
        project,
        projectId: dto.projectId,
        inviterUser,
        inviterUserId: requestUser.id,
        inviteeUser,
        inviteeUserId: inviteeUser.id,
        projectRole,
        projectRoleId: projectRole.id,
        token: this.generateToken(),
        status: InviteStatus.PENDING,
        expiresAt: this.expiresAt(),
        acceptedAt: null,
        message: dto.message ?? null,
      });
      const saved = await tx.save(newInvite);

      await tx.save(
        tx.create(ProjectActivityLog, {
          project,
          projectId: dto.projectId,
          user: inviterUser,
          userId: requestUser.id,
          actionType: ProjectActionType.INVITE_SENT,
          actionMeta: {
            inviteeUserId: inviteeUser.id,
            inviteeEmail: inviteeUser.email,
            projectRoleId: projectRole.id,
            projectRoleSlug: projectRole.slug,
          },
        }),
      );

      return saved;
    });

    // Reload with full relations for serialization
    const full = await this.inviteRepo.findOne({
      where: { id: invite.id },
      relations: ['inviterUser', 'inviteeUser', 'projectRole'],
    });

    // Fire-and-forget notification to the invitee (non-blocking)
    void this.notificationsService
      .createNotification({
        userId: inviteeUser.id,
        type: NotificationType.INVITE_RECEIVED,
        title: `You've been invited to join a project`,
        body: `${inviterUser.firstName} ${inviterUser.lastName} invited you to join the project as ${projectRole.name}.`,
        meta: {
          inviteId: invite.id,
          projectId: dto.projectId,
          projectRoleId: projectRole.id,
          projectRoleName: projectRole.name,
        },
      })
      .catch(() => void 0); // swallow notification errors — invite creation still succeeds

    return this.toSerializer(full!);
  }

  // ---------------------------------------------------------------------------
  // List invites for a project
  // ---------------------------------------------------------------------------

  async listInvites(
    projectId: string,
    filters: InviteFiltersDto,
    requestUser: RequestUser,
  ): Promise<{ items: ProjectInviteSerializer[]; count: number }> {
    await this.requireProjectMembership(projectId, requestUser);

    const { page, limit, status } = filters;

    const qb = this.inviteRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.inviterUser', 'inviterUser')
      .leftJoinAndSelect('inv.inviteeUser', 'inviteeUser')
      .leftJoinAndSelect('inv.projectRole', 'projectRole')
      .where('inv.projectId = :projectId', { projectId })
      .orderBy('inv.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

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
      relations: ['inviterUser', 'inviteeUser', 'projectRole'],
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
   * Core accept logic — works on an already-loaded and validated invite.
   * Called by both the token-based and ID-based public methods.
   */
  private async acceptInviteEntity(invite: ProjectInvite): Promise<{
    workspaceId: string;
    projectId: string;
    inviteId: string;
    message: string | null;
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
        permissions: ProjectPermissionMatrix;
      } | null;
    };
  }> {
    if (
      !invite.projectRole ||
      invite.projectRole.projectId !== invite.projectId ||
      !invite.projectRole.status
    ) {
      throw new BadRequestException(INVITE_PROJECT_ROLE_UNAVAILABLE);
    }

    // Invitee is stored by userId — just verify the account still exists
    const inviteeUser = await this.userRepo.findOne({
      where: { id: invite.inviteeUserId },
    });
    if (!inviteeUser) throw new NotFoundException(INVITEE_ACCOUNT_NOT_FOUND);

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
      } else {
        // Already an active member — just update the role if it changed
        membership.invitedByUser = invite.inviterUser ?? null;
        membership.invitedByUserId = invite.inviterUserId;
        membership.inviteId = invite.id;
        membership.projectRole = invite.projectRole;
        membership.projectRoleId = invite.projectRoleId;
        membership = await tx.save(membership);
      }

      // 2. Auto-enroll invitee as workspace guest (idempotent — skips if already a member)
      //    This is the step that allows the invitee to pass WorkspaceGuard and see their project.
      await this.ensureWorkspaceMembership(
        tx,
        inviteeUser,
        invite.project.workspaceId,
        invite.inviterUser ?? inviteeUser, // fall back to self if inviter not loaded
      );

      // 3. Mark invite accepted
      invite.status = InviteStatus.ACCEPTED;
      invite.acceptedAt = new Date();
      await tx.save(invite);

      // 4. Activity log
      await tx.save(
        tx.create(ProjectActivityLog, {
          project: invite.project,
          projectId: invite.projectId,
          user: inviteeUser,
          userId: inviteeUser.id,
          actionType: ProjectActionType.INVITE_ACCEPTED,
          actionMeta: {
            inviteId: invite.id,
            membershipId: membership.id,
            projectRoleId: invite.projectRoleId,
            projectRoleName: invite.projectRole.name,
            projectRoleSlug: invite.projectRole.slug,
          },
        }),
      );

      return membership;
    });

    const role = result.projectRole ?? invite.projectRole;

    // Notify the inviter that the invite was accepted (fire-and-forget)
    void this.notificationsService
      .createNotification({
        userId: invite.inviterUserId,
        type: NotificationType.INVITE_ACCEPTED,
        title: 'Invite accepted',
        body: `${inviteeUser.firstName} ${inviteeUser.lastName} accepted your project invite.`,
        meta: {
          inviteId: invite.id,
          projectId: invite.projectId,
          inviteeUserId: inviteeUser.id,
        },
      })
      .catch(() => void 0);

    return {
      // workspaceId tells the frontend which workspace to switch to so the
      // accepted project immediately appears in GET /projects.
      workspaceId: invite.project.workspaceId,
      projectId: invite.projectId,
      inviteId: invite.id,
      message: invite.message,
      membership: {
        id: result.id,
        status: result.status,
        projectRoleId: result.projectRoleId,
        projectRole: role
          ? {
              id: role.id,
              name: role.name,
              slug: role.slug,
              status: role.status,
              isSystem: role.isSystem,
              isProtected: role.isProtected,
              permissions: role.permissions,
            }
          : null,
      },
    };
  }

  /**
   * Accept an invite by its one-time token (email-link / unauthenticated flow).
   *
   * Steps:
   *  1. Validate token — must be PENDING and not expired.
   *  2. Delegate to acceptInviteEntity for the actual accept logic.
   */
  async acceptInvite(token: string): Promise<ReturnType<ProjectInvitesService['acceptInviteEntity']>> {
    if (!token?.trim()) {
      throw new BadRequestException(
        'A token query parameter is required. To accept an invite as a logged-in user, use POST /project-invites/:inviteId/accept instead.',
      );
    }

    const invite = await this.inviteRepo.findOne({
      where: { token },
      relations: ['project', 'inviterUser', 'inviteeUser', 'projectRole'],
    });

    if (!invite) throw new NotFoundException(INVITE_NOT_FOUND);

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException(INVITE_TOKEN_INVALID);
    }

    // Mark expired if past TTL
    if (invite.expiresAt < new Date()) {
      invite.status = InviteStatus.EXPIRED;
      await this.inviteRepo.save(invite);
      throw new BadRequestException(INVITE_TOKEN_INVALID);
    }

    return this.acceptInviteEntity(invite);
  }

  // ---------------------------------------------------------------------------
  // Accept invite by inviteId (authenticated — invitee must match JWT user)
  // ---------------------------------------------------------------------------

  async acceptInviteById(
    inviteId: string,
    requestUser: RequestUser,
  ): Promise<ReturnType<typeof this.acceptInvite>> {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
      relations: ['project', 'inviterUser', 'inviteeUser', 'projectRole'],
    });

    if (!invite) throw new NotFoundException(INVITE_NOT_FOUND);

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException(INVITE_NOT_PENDING);
    }

    // Check expiry (same rule as token-based flow)
    if (invite.expiresAt < new Date()) {
      invite.status = InviteStatus.EXPIRED;
      await this.inviteRepo.save(invite);
      throw new BadRequestException(INVITE_TOKEN_INVALID);
    }

    if (invite.inviteeUserId !== requestUser.id) {
      throw new ForbiddenException(INVITE_NOT_YOURS);
    }

    // Run the accept logic directly using the already-loaded invite
    // (avoids a redundant DB round-trip that the token-based flow would do)
    return this.acceptInviteEntity(invite);
  }

  // ---------------------------------------------------------------------------
  // Decline invite (authenticated — invitee only)
  // ---------------------------------------------------------------------------

  async declineInvite(
    inviteId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; declined: true }> {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
      relations: ['inviteeUser'],
    });

    if (!invite) throw new NotFoundException(INVITE_NOT_FOUND);

    if (invite.inviteeUserId !== requestUser.id) {
      throw new ForbiddenException(INVITE_NOT_YOURS);
    }

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException(INVITE_NOT_PENDING);
    }

    invite.status = InviteStatus.DECLINED;
    await this.inviteRepo.save(invite);

    // Notify the inviter (fire-and-forget)
    const inviteeUser = invite.inviteeUser;
    void this.notificationsService
      .createNotification({
        userId: invite.inviterUserId,
        type: NotificationType.INVITE_DECLINED,
        title: 'Invite declined',
        body: inviteeUser
          ? `${inviteeUser.firstName} ${inviteeUser.lastName} declined your project invite.`
          : 'Your project invite was declined.',
        meta: {
          inviteId: invite.id,
          projectId: invite.projectId,
          inviteeUserId: invite.inviteeUserId,
        },
      })
      .catch(() => void 0);

    return { id: inviteId, declined: true };
  }

  // ---------------------------------------------------------------------------
  // List invites received by the current user (invitee perspective)
  // ---------------------------------------------------------------------------

  async listReceivedInvites(
    requestUser: RequestUser,
    filters: InviteFiltersDto,
  ): Promise<{ items: ProjectInviteSerializer[]; count: number }> {
    const { page, limit, status } = filters;

    const qb = this.inviteRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.inviterUser', 'inviterUser')
      .leftJoinAndSelect('inv.inviteeUser', 'inviteeUser')
      .leftJoinAndSelect('inv.projectRole', 'projectRole')
      .leftJoinAndSelect('inv.project', 'project')
      .where('inv.inviteeUserId = :userId', { userId: requestUser.id })
      .orderBy('inv.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.andWhere('inv.status = :status', { status });
    }

    const [invites, count] = await qb.getManyAndCount();

    return {
      items: invites.map((i) => this.toSerializer(i)),
      count,
    };
  }
}
