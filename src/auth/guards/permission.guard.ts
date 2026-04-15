import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { INSUFFICIENT_PERMISSIONS } from '../messages';
import type { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import type { PermissionDomain, PermissionAction } from 'src/roles/types/permission-matrix.type';

export interface RequiredPermission {
  domain: PermissionDomain;
  action: PermissionAction;
}

/**
 * PermissionGuard
 *
 * Reads the RequiredPermission metadata set by @RequireWorkspacePermission(domain, action)
 * and checks that the authenticated user's workspace-role matrix (attached to
 * req.workspaceMember by WorkspaceGuard) grants the required access.
 *
 * Guard order: JwtAuthGuard → WorkspaceGuard → PermissionGuard
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, WorkspaceGuard, PermissionGuard)
 *   @RequireWorkspacePermission('userManagement', 'create')
 *   createUser(...) { ... }
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<RequiredPermission | undefined>(
      REQUIRE_PERMISSION_KEY,
      context.getHandler(),
    );

    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ workspaceMember?: WorkspaceMember }>();
    const member = request.workspaceMember;

    if (!member) {
      throw new UnauthorizedException('Workspace context is required for this endpoint');
    }

    const matrix = member.workspaceRole?.permissions;
    if (!matrix?.[required.domain]?.[required.action]) {
      throw new ForbiddenException(INSUFFICIENT_PERMISSIONS);
    }

    return true;
  }
}
