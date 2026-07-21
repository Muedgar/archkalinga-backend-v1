/**
 * Project-scoped permission matrix.
 *
 * Project task access model:
 *   - Project membership grants access to the project itself.
 *   - The member's project role decides whether they can view tasks.
 *   - `taskManagement.view = false` means no task access.
 *   - `taskManagement.view = true` + `viewScope = 'all'` means all project
 *     tasks/subtasks are visible.
 *   - `taskManagement.view = true` + `viewScope = 'assigned'` means only tasks
 *     where the member is creator, assignee, or reportee are visible.
 *   - Project creator and workspace admin are privileged visibility paths.
 *
 * Task assignment is responsibility, not the primary project-level access grant.
 * Use project membership + project role for project-wide visibility.
 *
 * Domains cover only resources that live inside a project:
 *   - taskManagement          → tasks and subtasks
 *   - documentManagement      → project documents
 *   - changeRequestManagement → change requests
 *   - projectRoleManagement   → project-scoped roles
 *   - projectConfigManagement → statuses, priorities, severities, task types, labels
 *   - projectMemberManagement → members, member roles, and project invites
 *
 * Higher-level resources (templates, workspace users, workspace roles, the
 * project entity itself) are governed by the workspace-role matrix, not here.
 *
 * `canManageProject` is a top-level boolean flag (not a nested domain) that
 * remains as a compatibility umbrella for project-admin actions during the
 * granular-permissions rollout. New checks should prefer the explicit domains
 * above.
 */
export const PROJECT_PERMISSION_DOMAINS = [
  'taskManagement',
  'documentManagement',
  'changeRequestManagement',
  'projectRoleManagement',
  'projectConfigManagement',
  'projectMemberManagement',
] as const;

export type ProjectPermissionDomain =
  (typeof PROJECT_PERMISSION_DOMAINS)[number];
export type ProjectPermissionAction = 'create' | 'update' | 'view' | 'delete';

/**
 * Controls which tasks a member can see in task list/detail/report surfaces.
 *
 *  'all'      — member sees every task and subtask in the project
 *  'assigned' — member sees only tasks where they are creator, assignee, or
 *               reportee (appropriate for Viewer / Guest / subcontractor roles)
 */
export type TaskViewScope = 'all' | 'assigned';

export type ProjectCrudPermissionSet = {
  create: boolean;
  update: boolean;
  view: boolean;
  delete: boolean;
};

export type ProjectPermissionMatrix = {
  /**
   * Compatibility umbrella for project admin actions.
   * Prefer projectRoleManagement, projectConfigManagement, and
   * projectMemberManagement for new authorization checks.
   */
  canManageProject: boolean;
  taskManagement: {
    create: boolean;
    update: boolean;
    view: boolean;
    delete: boolean;
    /**
     * Limits task list/detail/report visibility.
     * 'all'      → see every project task/subtask
     * 'assigned' → see only tasks the user created, is assigned to, or reports to
     */
    viewScope: TaskViewScope;
  };
  documentManagement: ProjectCrudPermissionSet;
  changeRequestManagement: ProjectCrudPermissionSet;
  projectRoleManagement: ProjectCrudPermissionSet;
  projectConfigManagement: ProjectCrudPermissionSet;
  projectMemberManagement: ProjectCrudPermissionSet;
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
  projectRoleManagement:   { create: true,  update: true,  view: true, delete: true  },
  projectConfigManagement: { create: true,  update: true,  view: true, delete: true  },
  projectMemberManagement: { create: true,  update: true,  view: true, delete: true  },
};

// Manager — full task access, no delete, sees all tasks
export const MANAGE_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        true,
  taskManagement:          { create: true,  update: true,  view: true, delete: false, viewScope: 'all' },
  documentManagement:      { create: true,  update: true,  view: true, delete: false },
  changeRequestManagement: { create: true,  update: true,  view: true, delete: false },
  projectRoleManagement:   { create: true,  update: true,  view: true, delete: true  },
  projectConfigManagement: { create: true,  update: true,  view: true, delete: true  },
  projectMemberManagement: { create: true,  update: true,  view: true, delete: true  },
};

// Contributor — can create and update tasks, sees all tasks
export const CONTRIBUTOR_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        false,
  taskManagement:          { create: true,  update: true,  view: true, delete: false, viewScope: 'all' },
  documentManagement:      { create: true,  update: true,  view: true, delete: false },
  changeRequestManagement: { create: true,  update: true,  view: true, delete: false },
  projectRoleManagement:   { create: false, update: false, view: false, delete: false },
  projectConfigManagement: { create: false, update: false, view: true,  delete: false },
  projectMemberManagement: { create: false, update: false, view: true,  delete: false },
};

// Reviewer — can update and review tasks, sees all tasks
export const REVIEWER_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        false,
  taskManagement:          { create: false, update: true,  view: true, delete: false, viewScope: 'all' },
  documentManagement:      { create: false, update: true,  view: true, delete: false },
  changeRequestManagement: { create: true,  update: true,  view: true, delete: false },
  projectRoleManagement:   { create: false, update: false, view: false, delete: false },
  projectConfigManagement: { create: false, update: false, view: true,  delete: false },
  projectMemberManagement: { create: false, update: false, view: true,  delete: false },
};

// Viewer — read-only, sees ONLY their own assigned/reportee tasks
export const VIEWER_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        false,
  taskManagement:          { create: false, update: false, view: true, delete: false, viewScope: 'assigned' },
  documentManagement:      { create: false, update: false, view: true, delete: false },
  changeRequestManagement: { create: false, update: false, view: true, delete: false },
  projectRoleManagement:   { create: false, update: false, view: false, delete: false },
  projectConfigManagement: { create: false, update: false, view: true,  delete: false },
  projectMemberManagement: { create: false, update: false, view: false, delete: false },
};

// Empty — no access
export const EMPTY_PROJECT_ACCESS_MATRIX: ProjectPermissionMatrix = {
  canManageProject:        false,
  taskManagement:          { create: false, update: false, view: false, delete: false, viewScope: 'assigned' },
  documentManagement:      { create: false, update: false, view: false, delete: false },
  changeRequestManagement: { create: false, update: false, view: false, delete: false },
  projectRoleManagement:   { create: false, update: false, view: false, delete: false },
  projectConfigManagement: { create: false, update: false, view: false, delete: false },
  projectMemberManagement: { create: false, update: false, view: false, delete: false },
};
