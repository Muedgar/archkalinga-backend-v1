/**
 * Project-scoped permission matrix.
 *
 * Domains cover only resources that live inside a project:
 *   - taskManagement          → tasks and subtasks
 *   - documentManagement      → project documents
 *   - changeRequestManagement → change requests
 *
 * Higher-level resources (templates, workspace users, workspace roles, the
 * project entity itself) are governed by the workspace-role matrix, not here.
 *
 * `canManageProject` is a top-level boolean flag (not a nested domain) that
 * gates project-admin actions: updating project settings, managing invites,
 * managing project roles, and updating member roles.
 * Owner and Manager system roles carry this flag as true; all others default
 * to false.
 */
export const PROJECT_PERMISSION_DOMAINS = [
  'taskManagement',
  'documentManagement',
  'changeRequestManagement',
] as const;

export type ProjectPermissionDomain =
  (typeof PROJECT_PERMISSION_DOMAINS)[number];
export type ProjectPermissionAction = 'create' | 'update' | 'view' | 'delete';

/**
 * Controls which tasks a member can see in GET /tasks.
 *
 *  'all'      — member sees every task in the project (default for active roles)
 *  'assigned' — member sees only tasks where they are an assignee or reportee
 *               (appropriate for Viewer / Guest / subcontractor roles)
 */
export type TaskViewScope = 'all' | 'assigned';

export type ProjectPermissionMatrix = {
  /** Grants access to project admin actions (settings, invites, roles). */
  canManageProject: boolean;
  taskManagement: {
    create: boolean;
    update: boolean;
    view: boolean;
    delete: boolean;
    /**
     * Limits task list/detail visibility.
     * 'all'      → see every project task
     * 'assigned' → see only tasks the user is assigned to or is reportee of
     */
    viewScope: TaskViewScope;
  };
  documentManagement:      { create: boolean; update: boolean; view: boolean; delete: boolean };
  changeRequestManagement: { create: boolean; update: boolean; view: boolean; delete: boolean };
};

// ---------------------------------------------------------------------------
// Preset matrices used when seeding default project roles
// ---------------------------------------------------------------------------

// Owner — full control, sees all tasks
export const FULL_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        true,
  taskManagement:          { create: true,  update: true,  view: true, delete: true,  viewScope: 'all' },
  documentManagement:      { create: true,  update: true,  view: true, delete: true  },
  changeRequestManagement: { create: true,  update: true,  view: true, delete: true  },
};

// Manager — full task access, no delete, sees all tasks
export const MANAGE_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        true,
  taskManagement:          { create: true,  update: true,  view: true, delete: false, viewScope: 'all' },
  documentManagement:      { create: true,  update: true,  view: true, delete: false },
  changeRequestManagement: { create: true,  update: true,  view: true, delete: false },
};

// Contributor — can create and update tasks, sees all tasks
export const CONTRIBUTOR_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        false,
  taskManagement:          { create: true,  update: true,  view: true, delete: false, viewScope: 'all' },
  documentManagement:      { create: true,  update: true,  view: true, delete: false },
  changeRequestManagement: { create: true,  update: true,  view: true, delete: false },
};

// Reviewer — can update and review tasks, sees all tasks
export const REVIEWER_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        false,
  taskManagement:          { create: false, update: true,  view: true, delete: false, viewScope: 'all' },
  documentManagement:      { create: false, update: true,  view: true, delete: false },
  changeRequestManagement: { create: true,  update: true,  view: true, delete: false },
};

// Viewer — read-only, sees ONLY their own assigned/reportee tasks
export const VIEWER_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        false,
  taskManagement:          { create: false, update: false, view: true, delete: false, viewScope: 'assigned' },
  documentManagement:      { create: false, update: false, view: true, delete: false },
  changeRequestManagement: { create: false, update: false, view: true, delete: false },
};

// Empty — no access
export const EMPTY_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        false,
  taskManagement:          { create: false, update: false, view: false, delete: false, viewScope: 'assigned' },
  documentManagement:      { create: false, update: false, view: false, delete: false },
  changeRequestManagement: { create: false, update: false, view: false, delete: false },
};
