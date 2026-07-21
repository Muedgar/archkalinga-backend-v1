import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities';
import { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { Project, ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import { WorkspaceMemberStatus } from 'src/workspaces/entities/workspace-member.entity';
import type {
  ProjectPermissionAction,
  ProjectPermissionDomain,
} from 'src/projects/types/project-permission-matrix.type';
import {
  INSUFFICIENT_PROJECT_PERMISSIONS,
  PROJECT_CONTEXT_REQUIRED,
  PROJECT_MEMBERSHIP_REQUIRED,
} from '../messages';
import { REQUIRE_PROJECT_PERMISSION_KEY } from '../decorators/require-project-permission.decorator';

export interface RequiredProjectPermission {
  domain: ProjectPermissionDomain | 'canManageProject';
  action?: ProjectPermissionAction;
}

/**
 * ProjectPermissionGuard
 *
 * Reads the RequiredProjectPermission metadata set by @RequireProjectPermission
 * and checks that the authenticated user's active project membership grants access.
 *
 * Two check modes:
 *   - domain === 'canManageProject'  → checks membership.projectRole.permissions.canManageProject === true
 *   - any resource domain            → checks membership.projectRole.permissions[domain][action] === true
 *
 * Workspace admins bypass project-level checks entirely.
 * Must be placed AFTER JwtAuthGuard so request.user is populated.
 */
@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(WorkspaceMember)
    private readonly workspaceMemberRepo: Repository<WorkspaceMember>,
  ) {}

  private resolveProjectId(request: {
    params?: Record<string, unknown>;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  }): string | null {
    const candidates = [
      request.params?.projectId,
      request.params?.id,
      request.body?.projectId,
      request.query?.projectId,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return null;
  }

  private resolveWorkspaceId(request: {
    headers?: Record<string, string | string[] | undefined>;
  }): string | null {
    const rawHeader = request.headers?.['x-workspace-id'];
    const workspaceId =
      typeof rawHeader === 'string' ? rawHeader.trim() : undefined;

    return workspaceId && workspaceId.length > 0 ? workspaceId : null;
  }

  private async resolveWorkspaceMember(
    request: {
      user?: User;
      workspaceMember?: WorkspaceMember;
      headers?: Record<string, string | string[] | undefined>;
    },
  ): Promise<WorkspaceMember | null> {
    if (request.workspaceMember) {
      return request.workspaceMember;
    }

    const workspaceId = this.resolveWorkspaceId(request);
    const userId = request.user?.id;
    if (!workspaceId || !userId) {
      return null;
    }

    const member = await this.workspaceMemberRepo.findOne({
      where: {
        workspaceId,
        userId,
        status: WorkspaceMemberStatus.ACTIVE,
      },
      relations: ['workspaceRole'],
    });

    if (member) {
      request.workspaceMember = member;
    }

    return member;
  }

  private canUseWorkspacePermission(
    required: RequiredProjectPermission | undefined,
    workspaceMember: WorkspaceMember | null,
  ): boolean {
    if (!workspaceMember) {
      return false;
    }

    const workspacePermissions = workspaceMember.workspaceRole?.permissions;
    if (!workspacePermissions) {
      return false;
    }

    if (!required) {
      return workspacePermissions.projectManagement?.view === true;
    }

    if (required.domain === 'canManageProject') {
      if (workspaceMember.workspaceRole?.slug === 'admin') {
        return true;
      }

      const fallbackAction = required.action ?? 'update';
      return workspacePermissions.projectManagement?.[fallbackAction] === true;
    }

    if (!required.action) {
      return false;
    }

    return workspacePermissions[required.domain]?.[required.action] === true;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<RequiredProjectPermission | undefined>(
      REQUIRE_PROJECT_PERMISSION_KEY,
      context.getHandler(),
    );

    const request = context.switchToHttp().getRequest<{
      user?: User;
      workspaceMember?: WorkspaceMember;
      headers?: Record<string, string | string[] | undefined>;
      params?: Record<string, unknown>;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
    }>();
    const user = request.user;

    const projectId = this.resolveProjectId(request);
    if (!required && !projectId) return true;

    if (!projectId) {
      throw new BadRequestException(PROJECT_CONTEXT_REQUIRED);
    }

    const [project, workspaceMember] = await Promise.all([
      this.projectRepo.findOne({
        where: { id: projectId },
        select: ['id', 'workspaceId'],
      }),
      this.resolveWorkspaceMember(request),
    ]);

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const isSameWorkspace =
      !!workspaceMember && workspaceMember.workspaceId === project.workspaceId;

    if (
      isSameWorkspace &&
      this.canUseWorkspacePermission(required, workspaceMember)
    ) {
      return true;
    }

    const membership = await this.membershipRepo.findOne({
      where: {
        projectId,
        userId: user?.id,
        status: MembershipStatus.ACTIVE,
      },
      relations: ['projectRole'],
    });

    if (!membership) {
      throw new ForbiddenException(PROJECT_MEMBERSHIP_REQUIRED);
    }

    // Attach the loaded membership to the request so downstream service methods
    // can reuse it without issuing a redundant DB query for the same row.
    (request as any).projectMembership = membership;

    const permissions = membership.projectRole?.permissions;

    // Some project routes only require active membership, not a specific project
    // permission. In that mode the guard still does useful work by attaching the
    // membership for the service layer.
    if (!required) return true;

    // ── canManageProject flag ──────────────────────────────────────────────────
    if (required.domain === 'canManageProject') {
      if (!permissions?.canManageProject) {
        throw new ForbiddenException(INSUFFICIENT_PROJECT_PERMISSIONS);
      }
      return true;
    }

    // ── Resource domain + action ───────────────────────────────────────────────
    if (!required.action) {
      throw new BadRequestException('Permission action is required for resource domains');
    }

    if (!permissions?.[required.domain]?.[required.action]) {
      throw new ForbiddenException(INSUFFICIENT_PROJECT_PERMISSIONS);
    }

    return true;
  }
}
