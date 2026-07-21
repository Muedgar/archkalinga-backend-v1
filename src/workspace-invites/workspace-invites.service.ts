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
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationType } from 'src/notifications/entities/notification.entity';
import { WorkspaceRole } from 'src/roles/roles.entity';
import { PermissionMatrix } from 'src/roles/types/permission-matrix.type';
import { User } from 'src/users/entities/user.entity';
import {
  Workspace,
  WorkspaceInvite,
  WorkspaceInviteStatus,
  WorkspaceMember,
  WorkspaceMemberStatus,
} from 'src/workspaces/entities';

import { CreateWorkspaceInviteDto, WorkspaceInviteFiltersDto } from './dtos';
import { WorkspaceInviteSerializer } from './serializers';
import {
  WORKSPACE_INVITE_ACCEPTED,
  WORKSPACE_INVITE_ALREADY_MEMBER,
  WORKSPACE_INVITE_DECLINED,
  WORKSPACE_INVITE_DUPLICATE,
  WORKSPACE_INVITE_FORBIDDEN,
  WORKSPACE_INVITE_INVITEE_ACCOUNT_NOT_FOUND,
  WORKSPACE_INVITE_NOT_FOUND,
  WORKSPACE_INVITE_NOT_PENDING,
  WORKSPACE_INVITE_ROLE_INVALID,
  WORKSPACE_INVITE_ROLE_UNAVAILABLE,
  WORKSPACE_INVITE_TOKEN_INVALID,
  WORKSPACE_INVITE_WORKSPACE_NOT_FOUND,
} from './messages';

const WORKSPACE_INVITE_NOT_YOURS = 'This workspace invite was not sent to you';

// Token TTL: 7 days
const WORKSPACE_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class WorkspaceInvitesService {
  constructor(
    @InjectRepository(WorkspaceInvite)
    private readonly inviteRepo: Repository<WorkspaceInvite>,

    @InjectRepository(WorkspaceMember)
    private readonly memberRepo: Repository<WorkspaceMember>,

    @InjectRepository(WorkspaceRole)
    private readonly workspaceRoleRepo: Repository<WorkspaceRole>,

    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly notificationsService: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private toSerializer(invite: WorkspaceInvite): WorkspaceInviteSerializer {
    return plainToInstance(WorkspaceInviteSerializer, invite, {
      excludeExtraneousValues: true,
    });
  }

  private generateToken(): string {
    return randomBytes(48).toString('hex');
  }

  private expiresAt(): Date {
    return new Date(Date.now() + WORKSPACE_INVITE_TTL_MS);
  }

  private async requireWorkspaceInviteManagement(
    workspaceId: string,
    requestUser: RequestUser,
  ): Promise<WorkspaceMember> {
    const member = await this.memberRepo.findOne({
      where: {
        workspaceId,
        userId: requestUser.id,
        status: WorkspaceMemberStatus.ACTIVE,
      },
      relations: ['workspaceRole'],
    });

    const canInvite =
      member?.workspaceRole?.permissions?.userManagement?.create === true;

    if (!member || !canInvite) {
      throw new ForbiddenException(WORKSPACE_INVITE_FORBIDDEN);
    }

    return member;
  }

  // ---------------------------------------------------------------------------
  // Create invite
  // ---------------------------------------------------------------------------

  async createInvite(
    dto: CreateWorkspaceInviteDto,
    requestUser: RequestUser,
  ): Promise<WorkspaceInviteSerializer> {
    await this.requireWorkspaceInviteManagement(dto.workspaceId, requestUser);

    // 1. Verify workspace exists
    const workspace = await this.workspaceRepo.findOne({
      where: { id: dto.workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException(WORKSPACE_INVITE_WORKSPACE_NOT_FOUND);
    }

    // 2. Verify the workspace role belongs to this workspace and is active
    const workspaceRole = await this.workspaceRoleRepo.findOne({
      where: { id: dto.workspaceRoleId, workspaceId: dto.workspaceId },
    });
    if (!workspaceRole || !workspaceRole.status) {
      throw new BadRequestException(WORKSPACE_INVITE_ROLE_INVALID);
    }

    // 3. Verify invitee account exists
    const inviteeUser = await this.userRepo.findOne({
      where: { id: dto.inviteeUserId },
    });
    if (!inviteeUser) {
      throw new NotFoundException(WORKSPACE_INVITE_INVITEE_ACCOUNT_NOT_FOUND);
    }

    // 4. Guard: invitee must not already be an active workspace member
    const activeMembership = await this.memberRepo.findOne({
      where: {
        workspaceId: dto.workspaceId,
        userId: inviteeUser.id,
        status: WorkspaceMemberStatus.ACTIVE,
      },
    });
    if (activeMembership) {
      throw new ConflictException(WORKSPACE_INVITE_ALREADY_MEMBER);
    }

    // 5. Guard: no duplicate PENDING invite
    const duplicate = await this.inviteRepo.findOne({
      where: {
        workspaceId: dto.workspaceId,
        inviteeUserId: inviteeUser.id,
        status: WorkspaceInviteStatus.PENDING,
      },
    });
    if (duplicate) {
      throw new ConflictException(WORKSPACE_INVITE_DUPLICATE);
    }

    // 6. Load inviter for notification text and audit context
    const inviterUser = await this.userRepo.findOneOrFail({
      where: { id: requestUser.id },
    });

    // 7. Persist invite
    const invite = await this.inviteRepo.manager.transaction(async (tx) => {
      const newInvite = tx.create(WorkspaceInvite, {
        workspace,
        workspaceId: dto.workspaceId,
        inviterUser,
        inviterUserId: requestUser.id,
        inviteeUser,
        inviteeUserId: inviteeUser.id,
        workspaceRole,
        workspaceRoleId: workspaceRole.id,
        token: this.generateToken(),
        status: WorkspaceInviteStatus.PENDING,
        expiresAt: this.expiresAt(),
        acceptedAt: null,
        message: dto.message ?? null,
      });

      return tx.save(newInvite);
    });

    const full = await this.inviteRepo.findOne({
      where: { id: invite.id },
      relations: ['workspace', 'inviterUser', 'inviteeUser', 'workspaceRole'],
    });

    // Fire-and-forget notification to the invitee (non-blocking)
    void this.notificationsService
      .createNotification({
        userId: inviteeUser.id,
        type: NotificationType.WORKSPACE_INVITE_RECEIVED,
        title: `You've been invited to join a workspace`,
        body: `${inviterUser.firstName} ${inviterUser.lastName} invited you to join ${workspace.name} as ${workspaceRole.name}.`,
        meta: {
          inviteType: 'workspace',
          inviteId: invite.id,
          workspaceId: dto.workspaceId,
          workspaceRoleId: workspaceRole.id,
          workspaceRoleName: workspaceRole.name,
        },
      })
      .catch(() => void 0);

    return this.toSerializer(full!);
  }

  // ---------------------------------------------------------------------------
  // List invites for a workspace
  // ---------------------------------------------------------------------------

  async listInvites(
    workspaceId: string,
    filters: WorkspaceInviteFiltersDto,
    requestUser: RequestUser,
  ): Promise<{ items: WorkspaceInviteSerializer[]; count: number }> {
    await this.requireWorkspaceInviteManagement(workspaceId, requestUser);

    const { page, limit, status } = filters;

    const qb = this.inviteRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.workspace', 'workspace')
      .leftJoinAndSelect('inv.inviterUser', 'inviterUser')
      .leftJoinAndSelect('inv.inviteeUser', 'inviteeUser')
      .leftJoinAndSelect('inv.workspaceRole', 'workspaceRole')
      .where('inv.workspaceId = :workspaceId', { workspaceId })
      .orderBy('inv.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.andWhere('inv.status = :status', { status });
    }

    const [invites, count] = await qb.getManyAndCount();

    return {
      items: invites.map((invite) => this.toSerializer(invite)),
      count,
    };
  }

  // ---------------------------------------------------------------------------
  // Resend invite
  // ---------------------------------------------------------------------------

  async resendInvite(
    inviteId: string,
    requestUser: RequestUser,
  ): Promise<WorkspaceInviteSerializer> {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
      relations: ['workspace', 'inviterUser', 'inviteeUser', 'workspaceRole'],
    });
    if (!invite) {
      throw new NotFoundException(WORKSPACE_INVITE_NOT_FOUND);
    }

    await this.requireWorkspaceInviteManagement(invite.workspaceId, requestUser);

    if (invite.status !== WorkspaceInviteStatus.PENDING) {
      throw new BadRequestException(WORKSPACE_INVITE_NOT_PENDING);
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
    if (!invite) {
      throw new NotFoundException(WORKSPACE_INVITE_NOT_FOUND);
    }

    await this.requireWorkspaceInviteManagement(invite.workspaceId, requestUser);

    if (invite.status !== WorkspaceInviteStatus.PENDING) {
      throw new BadRequestException(WORKSPACE_INVITE_NOT_PENDING);
    }

    invite.status = WorkspaceInviteStatus.REVOKED;
    await this.inviteRepo.save(invite);

    return { id: inviteId, canceled: true };
  }

  // ---------------------------------------------------------------------------
  // Accept invite
  // ---------------------------------------------------------------------------

  private async acceptInviteEntity(invite: WorkspaceInvite): Promise<{
    workspaceId: string;
    inviteId: string;
    message: string | null;
    membership: {
      id: string;
      status: WorkspaceMemberStatus;
      workspaceRoleId: string;
      workspaceRole: {
        id: string;
        name: string;
        slug: string;
        status: boolean;
        isSystem: boolean;
        permissions: PermissionMatrix;
      } | null;
    };
  }> {
    if (
      !invite.workspaceRole ||
      invite.workspaceRole.workspaceId !== invite.workspaceId ||
      !invite.workspaceRole.status
    ) {
      throw new BadRequestException(WORKSPACE_INVITE_ROLE_UNAVAILABLE);
    }

    const inviteeUser = await this.userRepo.findOne({
      where: { id: invite.inviteeUserId },
    });
    if (!inviteeUser) {
      throw new NotFoundException(WORKSPACE_INVITE_INVITEE_ACCOUNT_NOT_FOUND);
    }

    const result = await this.inviteRepo.manager.transaction(async (tx) => {
      let membership = await tx.findOne(WorkspaceMember, {
        where: {
          workspaceId: invite.workspaceId,
          userId: inviteeUser.id,
        },
        relations: ['workspaceRole'],
      });

      if (!membership) {
        membership = tx.create(WorkspaceMember, {
          workspace: invite.workspace,
          workspaceId: invite.workspaceId,
          user: inviteeUser,
          userId: inviteeUser.id,
          workspaceRole: invite.workspaceRole,
          workspaceRoleId: invite.workspaceRoleId,
          status: WorkspaceMemberStatus.ACTIVE,
          joinedAt: new Date(),
          invitedByUser: invite.inviterUser ?? null,
          invitedByUserId: invite.inviterUserId,
        });
        membership = await tx.save(membership);
      } else if (membership.status === WorkspaceMemberStatus.REMOVED) {
        membership.status = WorkspaceMemberStatus.ACTIVE;
        membership.joinedAt = new Date();
        membership.invitedByUser = invite.inviterUser ?? null;
        membership.invitedByUserId = invite.inviterUserId;
        membership.workspaceRole = invite.workspaceRole;
        membership.workspaceRoleId = invite.workspaceRoleId;
        membership = await tx.save(membership);
      } else {
        membership.invitedByUser = invite.inviterUser ?? null;
        membership.invitedByUserId = invite.inviterUserId;
        membership.workspaceRole = invite.workspaceRole;
        membership.workspaceRoleId = invite.workspaceRoleId;
        membership = await tx.save(membership);
      }

      invite.status = WorkspaceInviteStatus.ACCEPTED;
      invite.acceptedAt = new Date();
      await tx.save(invite);

      return membership;
    });

    const role = result.workspaceRole ?? invite.workspaceRole;

    void this.notificationsService
      .createNotification({
        userId: invite.inviterUserId,
        type: NotificationType.WORKSPACE_INVITE_ACCEPTED,
        title: WORKSPACE_INVITE_ACCEPTED,
        body: `${inviteeUser.firstName} ${inviteeUser.lastName} accepted your workspace invite.`,
        meta: {
          inviteType: 'workspace',
          inviteId: invite.id,
          workspaceId: invite.workspaceId,
          inviteeUserId: inviteeUser.id,
        },
      })
      .catch(() => void 0);

    return {
      workspaceId: invite.workspaceId,
      inviteId: invite.id,
      message: invite.message,
      membership: {
        id: result.id,
        status: result.status,
        workspaceRoleId: result.workspaceRoleId,
        workspaceRole: role
          ? {
              id: role.id,
              name: role.name,
              slug: role.slug,
              status: role.status,
              isSystem: role.isSystem,
              permissions: role.permissions,
            }
          : null,
      },
    };
  }

  async acceptInvite(
    token: string,
  ): Promise<ReturnType<WorkspaceInvitesService['acceptInviteEntity']>> {
    if (!token?.trim()) {
      throw new BadRequestException(
        'A token query parameter is required. To accept a workspace invite as a logged-in user, use POST /workspace-invites/:inviteId/accept instead.',
      );
    }

    const invite = await this.inviteRepo.findOne({
      where: { token },
      relations: ['workspace', 'inviterUser', 'inviteeUser', 'workspaceRole'],
    });

    if (!invite) {
      throw new NotFoundException(WORKSPACE_INVITE_NOT_FOUND);
    }

    if (invite.status !== WorkspaceInviteStatus.PENDING) {
      throw new BadRequestException(WORKSPACE_INVITE_TOKEN_INVALID);
    }

    if (invite.expiresAt < new Date()) {
      invite.status = WorkspaceInviteStatus.EXPIRED;
      await this.inviteRepo.save(invite);
      throw new BadRequestException(WORKSPACE_INVITE_TOKEN_INVALID);
    }

    return this.acceptInviteEntity(invite);
  }

  async acceptInviteById(
    inviteId: string,
    requestUser: RequestUser,
  ): Promise<ReturnType<typeof this.acceptInvite>> {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
      relations: ['workspace', 'inviterUser', 'inviteeUser', 'workspaceRole'],
    });

    if (!invite) {
      throw new NotFoundException(WORKSPACE_INVITE_NOT_FOUND);
    }

    if (invite.status !== WorkspaceInviteStatus.PENDING) {
      throw new BadRequestException(WORKSPACE_INVITE_NOT_PENDING);
    }

    if (invite.expiresAt < new Date()) {
      invite.status = WorkspaceInviteStatus.EXPIRED;
      await this.inviteRepo.save(invite);
      throw new BadRequestException(WORKSPACE_INVITE_TOKEN_INVALID);
    }

    if (invite.inviteeUserId !== requestUser.id) {
      throw new ForbiddenException(WORKSPACE_INVITE_NOT_YOURS);
    }

    return this.acceptInviteEntity(invite);
  }

  // ---------------------------------------------------------------------------
  // Decline invite
  // ---------------------------------------------------------------------------

  async declineInvite(
    inviteId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; declined: true }> {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
      relations: ['inviteeUser'],
    });

    if (!invite) {
      throw new NotFoundException(WORKSPACE_INVITE_NOT_FOUND);
    }

    if (invite.inviteeUserId !== requestUser.id) {
      throw new ForbiddenException(WORKSPACE_INVITE_NOT_YOURS);
    }

    if (invite.status !== WorkspaceInviteStatus.PENDING) {
      throw new BadRequestException(WORKSPACE_INVITE_NOT_PENDING);
    }

    invite.status = WorkspaceInviteStatus.DECLINED;
    await this.inviteRepo.save(invite);

    const inviteeUser = invite.inviteeUser;
    void this.notificationsService
      .createNotification({
        userId: invite.inviterUserId,
        type: NotificationType.WORKSPACE_INVITE_DECLINED,
        title: WORKSPACE_INVITE_DECLINED,
        body: inviteeUser
          ? `${inviteeUser.firstName} ${inviteeUser.lastName} declined your workspace invite.`
          : 'Your workspace invite was declined.',
        meta: {
          inviteType: 'workspace',
          inviteId: invite.id,
          workspaceId: invite.workspaceId,
          inviteeUserId: invite.inviteeUserId,
        },
      })
      .catch(() => void 0);

    return { id: inviteId, declined: true };
  }

  // ---------------------------------------------------------------------------
  // List invites received by the current user
  // ---------------------------------------------------------------------------

  async listReceivedInvites(
    requestUser: RequestUser,
    filters: WorkspaceInviteFiltersDto,
  ): Promise<{ items: WorkspaceInviteSerializer[]; count: number }> {
    const { page, limit, status } = filters;

    const qb = this.inviteRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.workspace', 'workspace')
      .leftJoinAndSelect('inv.inviterUser', 'inviterUser')
      .leftJoinAndSelect('inv.inviteeUser', 'inviteeUser')
      .leftJoinAndSelect('inv.workspaceRole', 'workspaceRole')
      .where('inv.inviteeUserId = :userId', { userId: requestUser.id })
      .orderBy('inv.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.andWhere('inv.status = :status', { status });
    }

    const [invites, count] = await qb.getManyAndCount();

    return {
      items: invites.map((invite) => this.toSerializer(invite)),
      count,
    };
  }
}
