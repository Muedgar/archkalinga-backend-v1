import {
  CONTRIBUTOR_PROJECT_ACCESS_MATRIX,
  FULL_PROJECT_ACCESS_MATRIX,
  MANAGE_PROJECT_ACCESS_MATRIX,
  REVIEWER_PROJECT_ACCESS_MATRIX,
  VIEWER_PROJECT_ACCESS_MATRIX,
  type ProjectPermissionMatrix,
} from '../types/project-permission-matrix.type';

export type DefaultProjectRoleDefinition = {
  name: string;
  slug: string;
  isSystem: boolean;
  isProtected: boolean;
  permissions: ProjectPermissionMatrix;
};

export const DEFAULT_PROJECT_ROLE_DEFINITIONS: DefaultProjectRoleDefinition[] = [
  {
    name: 'Owner',
    slug: 'owner',
    isSystem: true,
    isProtected: true,
    permissions: FULL_PROJECT_ACCESS_MATRIX,       // canManageProject: true
  },
  {
    name: 'Manager',
    slug: 'manager',
    isSystem: true,
    isProtected: false,
    permissions: MANAGE_PROJECT_ACCESS_MATRIX,     // canManageProject: true
  },
  {
    name: 'Contributor',
    slug: 'contributor',
    isSystem: true,
    isProtected: false,
    permissions: CONTRIBUTOR_PROJECT_ACCESS_MATRIX, // canManageProject: false
  },
  {
    name: 'Reviewer',
    slug: 'reviewer',
    isSystem: true,
    isProtected: false,
    permissions: REVIEWER_PROJECT_ACCESS_MATRIX,   // canManageProject: false
  },
  {
    name: 'Viewer',
    slug: 'viewer',
    isSystem: true,
    isProtected: false,
    permissions: VIEWER_PROJECT_ACCESS_MATRIX,     // canManageProject: false
  },
];

export const DEFAULT_OWNER_PROJECT_ROLE_SLUG       = 'owner';
export const DEFAULT_CONTRIBUTOR_PROJECT_ROLE_SLUG = 'contributor';
