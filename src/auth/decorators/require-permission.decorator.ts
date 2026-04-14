import { SetMetadata } from '@nestjs/common';
import type {
  PermissionDomain,
  PermissionAction,
} from 'src/roles/types/permission-matrix.type';
import type { RequiredPermission } from '../guards/permission.guard';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

/**
 * Declares that the route requires the caller to hold a specific permission
 * in their workspace role's permission matrix.
 *
 * Usage:
 *   @RequirePermission('userManagement', 'create')
 *   @UseGuards(JwtAuthGuard, PermissionGuard)
 *   createUser(...) { ... }
 */
export const RequireWorkspacePermission = (
  domain: PermissionDomain,
  action: PermissionAction,
) =>
  SetMetadata<string, RequiredPermission>(REQUIRE_PERMISSION_KEY, {
    domain,
    action,
  });

/**
 * Backward-compatible alias for workspace-scoped authorization.
 */
export const RequirePermission = RequireWorkspacePermission;
