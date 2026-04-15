import { SetMetadata } from '@nestjs/common';
import type {
  ProjectPermissionAction,
  ProjectPermissionDomain,
} from 'src/projects/types/project-permission-matrix.type';
import type { RequiredProjectPermission } from '../guards/project-permission.guard';

export const REQUIRE_PROJECT_PERMISSION_KEY = 'require_project_permission';

/**
 * Declares that the route requires the caller to hold a specific permission
 * in their project membership role's permission matrix.
 *
 * Two forms:
 *
 *   // Resource-level permission (taskManagement, documentManagement, changeRequestManagement)
 *   @RequireProjectPermission('taskManagement', 'update')
 *
 *   // Admin flag — gates project settings, invite, and role management actions.
 *   // `action` is omitted; the guard checks canManageProject === true.
 *   @RequireProjectPermission('canManageProject')
 */
export const RequireProjectPermission = (
  domain: ProjectPermissionDomain | 'canManageProject',
  action?: ProjectPermissionAction,
) =>
  SetMetadata<string, RequiredProjectPermission>(
    REQUIRE_PROJECT_PERMISSION_KEY,
    { domain, action } as RequiredProjectPermission,
  );
