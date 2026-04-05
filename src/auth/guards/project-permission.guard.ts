import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities';
import { ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
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
  domain: ProjectPermissionDomain;
  action: ProjectPermissionAction;
}

/**
 * ProjectPermissionGuard
 *
 * Reads the RequiredProjectPermission metadata set by
 * @RequireProjectPermission(domain, action) and checks that the authenticated
 * user's active project membership grants that access.
 *
 * Must be placed AFTER JwtAuthGuard so request.user is populated.
 */
@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<RequiredProjectPermission | undefined>(
      REQUIRE_PROJECT_PERMISSION_KEY,
      context.getHandler(),
    );

    if (!required) return true;

    const request = context.switchToHttp().getRequest<{
      user?: User;
      params?: Record<string, unknown>;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
    }>();
    const user = request.user;

    if ((user as unknown as User | undefined)?.role?.slug === 'admin') {
      return true;
    }

    const projectId = this.resolveProjectId(request);
    if (!projectId) {
      throw new BadRequestException(PROJECT_CONTEXT_REQUIRED);
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

    const matrix = membership.projectRole?.permissions;
    if (!matrix?.[required.domain]?.[required.action]) {
      throw new ForbiddenException(INSUFFICIENT_PROJECT_PERMISSIONS);
    }

    return true;
  }
}
