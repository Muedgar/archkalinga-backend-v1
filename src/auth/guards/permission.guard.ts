import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { INSUFFICIENT_PERMISSIONS } from '../messages';
import { User } from 'src/users/entities';
import type { PermissionDomain, PermissionAction } from 'src/roles/types/permission-matrix.type';

export interface RequiredPermission {
  domain: PermissionDomain;
  action: PermissionAction;
}

/**
 * PermissionGuard
 *
 * Reads the RequiredPermission metadata set by @RequirePermission(domain, action)
 * and checks that the authenticated user's role matrix grants that access.
 *
 * Must be placed AFTER JwtAuthGuard so request.user is populated.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, PermissionGuard)
 *   @RequirePermission('userManagement', 'create')
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

    const request = context.switchToHttp().getRequest<{ user?: User }>();
    const user = request.user;
    const matrix = user?.role?.permissions;

    if (!matrix?.[required.domain]?.[required.action]) {
      throw new ForbiddenException(INSUFFICIENT_PERMISSIONS);
    }

    return true;
  }
}
