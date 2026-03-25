export const PERMISSION_DOMAINS = [
  'projectManagement',
  'changeRequestManagement',
  'taskManagement',
  'documentManagement',
  'userManagement',
  'roleManagement',
  'templateManagement',
] as const;

export type PermissionDomain = (typeof PERMISSION_DOMAINS)[number];
export type PermissionAction = 'create' | 'update' | 'view' | 'delete';

export type PermissionMatrix = {
  [domain in PermissionDomain]: {
    [action in PermissionAction]: boolean;
  };
};

/** Full access matrix used when creating the initial Admin role. */
export const FULL_ACCESS_MATRIX: PermissionMatrix = {
  projectManagement:       { create: true, update: true, view: true, delete: true },
  changeRequestManagement: { create: true, update: true, view: true, delete: true },
  taskManagement:          { create: true, update: true, view: true, delete: true },
  documentManagement:      { create: true, update: true, view: true, delete: true },
  userManagement:          { create: true, update: true, view: true, delete: true },
  roleManagement:          { create: true, update: true, view: true, delete: true },
  templateManagement:      { create: true, update: true, view: true, delete: true },
};

/** Empty (no-access) matrix — useful as a base for custom roles. */
export const EMPTY_ACCESS_MATRIX: PermissionMatrix = {
  projectManagement:       { create: false, update: false, view: false, delete: false },
  changeRequestManagement: { create: false, update: false, view: false, delete: false },
  taskManagement:          { create: false, update: false, view: false, delete: false },
  documentManagement:      { create: false, update: false, view: false, delete: false },
  userManagement:          { create: false, update: false, view: false, delete: false },
  roleManagement:          { create: false, update: false, view: false, delete: false },
  templateManagement:      { create: false, update: false, view: false, delete: false },
};
