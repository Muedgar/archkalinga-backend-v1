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
 *   // Resource-level permission (taskManagement, documentManagement, changeRequestManagement,
 *   // projectRoleManagement, projectConfigManagement, projectMemberManagement)
 *   @RequireProjectPermission('taskManagement', 'update')
 *
 *   // Compatibility admin flag — gates project settings and remains a rollout
 *   // fallback for granular project-admin domains.
 *   // `action` is optional and is used only for equivalent workspace-level
 *   // fallback checks against workspace projectManagement permissions.
 *   @RequireProjectPermission('canManageProject')
 *   @RequireProjectPermission('canManageProject', 'view')
 */
export const RequireProjectPermission = (
  domain: ProjectPermissionDomain | 'canManageProject',
  action?: ProjectPermissionAction,
) =>
  SetMetadata<string, RequiredProjectPermission>(
    REQUIRE_PROJECT_PERMISSION_KEY,
    { domain, action } as RequiredProjectPermission,
  );
