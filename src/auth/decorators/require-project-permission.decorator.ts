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
 * Usage:
 *   @RequireProjectPermission('taskManagement', 'update')
 *   @UseGuards(JwtAuthGuard, ProjectPermissionGuard)
 *   updateTask(...) { ... }
 */
export const RequireProjectPermission = (
  domain: ProjectPermissionDomain,
  action: ProjectPermissionAction,
) =>
  SetMetadata<string, RequiredProjectPermission>(
    REQUIRE_PROJECT_PERMISSION_KEY,
    { domain, action },
  );
