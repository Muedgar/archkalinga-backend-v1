export const PROJECT_PERMISSION_DOMAINS = [
  'projectManagement',
  'changeRequestManagement',
  'taskManagement',
  'documentManagement',
] as const;

export type ProjectPermissionDomain = (typeof PROJECT_PERMISSION_DOMAINS)[number];
export type ProjectPermissionAction = 'create' | 'update' | 'view' | 'delete';

export type ProjectPermissionMatrix = {
  [domain in ProjectPermissionDomain]: {
    [action in ProjectPermissionAction]: boolean;
  };
};

export const FULL_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  projectManagement:       { create: true, update: true, view: true, delete: true },
  changeRequestManagement: { create: true, update: true, view: true, delete: true },
  taskManagement:          { create: true, update: true, view: true, delete: true },
  documentManagement:      { create: true, update: true, view: true, delete: true },
};

export const MANAGE_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  projectManagement:       { create: false, update: true, view: true, delete: false },
  changeRequestManagement: { create: true, update: true, view: true, delete: false },
  taskManagement:          { create: true, update: true, view: true, delete: false },
  documentManagement:      { create: true, update: true, view: true, delete: false },
};

export const CONTRIBUTOR_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  projectManagement:       { create: false, update: false, view: true, delete: false },
  changeRequestManagement: { create: true, update: true, view: true, delete: false },
  taskManagement:          { create: true, update: true, view: true, delete: false },
  documentManagement:      { create: true, update: true, view: true, delete: false },
};

export const VIEWER_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  projectManagement:       { create: false, update: false, view: true, delete: false },
  changeRequestManagement: { create: false, update: false, view: true, delete: false },
  taskManagement:          { create: false, update: false, view: true, delete: false },
  documentManagement:      { create: false, update: false, view: true, delete: false },
};

export const EMPTY_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  projectManagement:       { create: false, update: false, view: false, delete: false },
  changeRequestManagement: { create: false, update: false, view: false, delete: false },
  taskManagement:          { create: false, update: false, view: false, delete: false },
  documentManagement:      { create: false, update: false, view: false, delete: false },
};
