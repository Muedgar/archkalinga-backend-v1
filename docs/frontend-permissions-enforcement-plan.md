# Frontend Permissions Enforcement Implementation Plan

## Purpose

Prepare the frontend for production by enforcing the same permission model the backend already enforces. Frontend enforcement is a user-experience and safety layer: it must hide, disable, or block UI affordances before users attempt forbidden actions, while the backend remains the final authority.

This plan is grounded in the current backend guards and decorators:

- Workspace permissions: `src/auth/guards/permission.guard.ts`
- Project permissions: `src/auth/guards/project-permission.guard.ts`
- Workspace matrix: `src/roles/types/permission-matrix.type.ts`
- Project matrix: `src/projects/types/project-permission-matrix.type.ts`

## Backend Permission Model To Mirror

### Workspace Role Permissions

Workspace permissions live on the active workspace role and use this shape:

```ts
type WorkspacePermissionAction = 'create' | 'update' | 'view' | 'delete';

type WorkspacePermissionDomain =
  | 'projectManagement'
  | 'changeRequestManagement'
  | 'taskManagement'
  | 'documentManagement'
  | 'userManagement'
  | 'roleManagement'
  | 'templateManagement';

type WorkspacePermissionMatrix = Record<
  WorkspacePermissionDomain,
  Record<WorkspacePermissionAction, boolean>
>;
```

Use workspace permissions for app-level resources:

| Backend permission | Frontend enforcement target |
| --- | --- |
| `projectManagement.create` | New Project buttons, create project routes/forms |
| `userManagement.create` | Invite/create workspace user actions |
| `userManagement.view` | Users page, audit logs page, user list/search screens that require admin visibility |
| `userManagement.update` | Edit user, deactivate/activate user, update workspace settings |
| `roleManagement.create` | Create workspace role |
| `roleManagement.view` | Workspace roles list/detail |
| `roleManagement.update` | Edit workspace role permissions/name/status |
| `templateManagement.create` | Create template actions |
| `templateManagement.view` | Templates nav item, template list/detail, template picker where protected by backend |
| `templateManagement.update` | Edit template actions |
| `templateManagement.delete` | Delete template actions |

Do not use workspace `projectManagement.update/delete` as the primary frontend gate for project detail actions. The live backend checks project-level permissions first, with workspace `projectManagement` as an admin fallback inside `ProjectPermissionGuard`.

### Project Role Permissions

Project permissions live on the user's active project membership role:

```ts
type ProjectPermissionAction = 'create' | 'update' | 'view' | 'delete';
type TaskViewScope = 'all' | 'assigned';

type ProjectPermissionMatrix = {
  canManageProject: boolean;
  taskManagement: {
    create: boolean;
    update: boolean;
    view: boolean;
    delete: boolean;
    viewScope: TaskViewScope;
  };
  documentManagement: {
    create: boolean;
    update: boolean;
    view: boolean;
    delete: boolean;
  };
  changeRequestManagement: {
    create: boolean;
    update: boolean;
    view: boolean;
    delete: boolean;
  };
  projectRoleManagement: {
    create: boolean;
    update: boolean;
    view: boolean;
    delete: boolean;
  };
  projectConfigManagement: {
    create: boolean;
    update: boolean;
    view: boolean;
    delete: boolean;
  };
  projectMemberManagement: {
    create: boolean;
    update: boolean;
    view: boolean;
    delete: boolean;
  };
};
```

Use project permissions inside a selected project:

| Backend permission | Frontend enforcement target |
| --- | --- |
| `canManageProject` | Edit/delete project; compatibility fallback for granular project-admin checks during rollout |
| `taskManagement.view` | Task board, task list, task detail, Gantt/activity schedule, task reports, task comments/checklists/watchers/material/resource views |
| `taskManagement.create` | Create task, create subtask/starter/deliverable, import task rows that create tasks |
| `taskManagement.update` | Edit task fields, move tasks, assign members, labels, relations, dependencies, comments, checklists, watchers, schedule recalculation, material/resource mutations |
| `taskManagement.delete` | Delete task, delete task-owned rows where backend uses task delete |
| `documentManagement.view` | Standalone project/document-management screens when their backend endpoints use this domain |
| `documentManagement.create` | Standalone document upload/create flows when their backend endpoints use this domain |
| `documentManagement.update` | Standalone document metadata/status/source flows when their backend endpoints use this domain |
| `documentManagement.delete` | Standalone document delete/remove flows when their backend endpoints use this domain |
| `changeRequestManagement.view` | Change request list/detail |
| `changeRequestManagement.create` | Raise/request a change |
| `changeRequestManagement.update` | Review/approve/reject/update change requests |
| `changeRequestManagement.delete` | Delete/cancel change requests where backend supports it |
| `projectRoleManagement.view` | Project roles list/detail |
| `projectRoleManagement.create` | Create project role |
| `projectRoleManagement.update` | Edit project role name/permissions/status |
| `projectRoleManagement.delete` | Delete project role |
| `projectConfigManagement.view` | Project statuses, priorities, severities, task types, labels |
| `projectConfigManagement.create` | Create project config items |
| `projectConfigManagement.update` | Update project config items |
| `projectConfigManagement.delete` | Delete project config items |
| `projectMemberManagement.view` | Project members and sent project invites |
| `projectMemberManagement.create` | Assign/invite project members |
| `projectMemberManagement.update` | Update member role and resend project invites |
| `projectMemberManagement.delete` | Cancel project invites; remove members if/when supported |

If `taskManagement.viewScope === 'assigned'`, the frontend must not pretend the user can see all project tasks. Let the backend filter the dataset, and adjust UI copy/counts so they read as "your visible tasks" rather than "all project tasks".

Live controller note: the current task-document endpoints in `src/tasks/tasks.controller.ts` are guarded with `taskManagement.view` for reads and `taskManagement.update` for create/update/delete document operations. Until the backend changes those decorators to `documentManagement`, task-document buttons and menus must follow the live `taskManagement` checks.

## Implementation Phases

### Phase 1: Centralize Permission Types And Helpers

Create or harden a single frontend permission module, for example:

- `lib/permissions/types.ts`
- `lib/permissions/checks.ts`
- `lib/permissions/resource-map.ts`
- `lib/permissions/components.tsx`

Required helper API:

```ts
export function hasWorkspacePermission(
  matrix: WorkspacePermissionMatrix | null | undefined,
  domain: WorkspacePermissionDomain,
  action: WorkspacePermissionAction,
): boolean;

export function hasProjectPermission(
  matrix: ProjectPermissionMatrix | null | undefined,
  domain: ProjectPermissionDomain,
  action: ProjectPermissionAction,
): boolean;

export function canManageProject(
  matrix: ProjectPermissionMatrix | null | undefined,
): boolean;

export function canManageProjectSettings(
  matrix: ProjectPermissionMatrix | null | undefined,
): boolean;

export function hasAnyPermission(checks: boolean[]): boolean;
export function hasAllPermissions(checks: boolean[]): boolean;
```

Rules:

- Return `false` when the permission matrix is missing, still loading, malformed, or missing a domain/action.
- Treat workspace and project matrices as separate inputs.
- Treat workspace admins the same way the backend does when the API returns full workspace/project access. Do not infer admin bypass from display names; use actual permission data.
- Keep permission checks outside feature hooks unless a hook's only purpose is permission derivation.

### Phase 2: Load And Store Permission Context

The frontend needs two active permission contexts:

1. Active workspace permission matrix from the authenticated user's workspace membership.
2. Active project permission matrix from the selected project membership/project role.

Implementation requirements:

- On login, refresh, workspace switch, and `/me` reload, store the current workspace role permission matrix.
- On project list/detail fetch, store the current user's project role permission matrix from the returned project membership/role payload.
- When the active project changes, clear the previous project permission matrix until the new one loads.
- Do not reuse a project permission matrix across projects.
- Cache permissions only as long as their owning workspace/project context is active.
- After role changes, invite acceptance, project switch, or workspace switch, invalidate the relevant user/project queries.

Recommended frontend state shape:

```ts
type PermissionState = {
  workspaceId: string | null;
  workspacePermissions: WorkspacePermissionMatrix | null;
  projectId: string | null;
  projectPermissions: ProjectPermissionMatrix | null;
  isPermissionContextReady: boolean;
};
```

### Phase 3: Add Reusable UI Enforcement Primitives

Create primitives that every feature can reuse:

```tsx
<PermissionGate
  allowed={canCreateTask}
  fallback={null}
>
  <CreateTaskButton />
</PermissionGate>
```

Also add helpers for repeated surfaces:

- `filterNavigationItems(items, permissionContext)`
- `filterMenuItems(items, permissionContext)`
- `getActionAvailability(action, permissionContext)`
- `withPermissionToast(handler, allowed, message)`
- `useWorkspacePermission(domain, action)`
- `useProjectPermission(domain, action)`
- `useCanManageProject()`
- `useProjectRolePermission(action)`
- `useProjectConfigPermission(action)`
- `useProjectMemberPermission(action)`

Recommended UX behavior:

| Surface | Behavior when unauthorized |
| --- | --- |
| Primary create buttons | Hide |
| Destructive row actions | Hide |
| Edit buttons on read-only detail pages | Hide |
| Menu items inside overflow menus | Hide unauthorized items; hide the menu trigger if empty |
| Tabs/sections backed by forbidden read endpoints | Hide |
| Directly visited forbidden routes | Show a 403/Not authorized page |
| Disabled due to entity state, not permission | Disable with tooltip explaining state |
| Disabled due to permission only | Prefer hiding; use disabled only where layout stability or discoverability is required |
| Bulk actions | Filter by permission first, then by selected row state |

### Phase 4: Gate Navigation And Routes

Navigation enforcement should happen before page-level rendering:

- Hide `Templates` unless `templateManagement.view`.
- Hide workspace `Users`/`Team` unless `userManagement.view`.
- Hide workspace `Roles` unless `roleManagement.view`.
- Hide audit logs unless `userManagement.view`.
- Show project list to any authenticated workspace member; backend already returns only projects where the user is a member.
- Hide `New Project` unless `projectManagement.create`.
- Inside project navigation, hide task/board/gantt/report pages unless `taskManagement.view`.
- Hide standalone project/document-management pages unless `documentManagement.view`; task document panels inside task pages currently follow `taskManagement.view`.
- Hide change request pages unless `changeRequestManagement.view`.
- Hide project settings unless `canManageProject`.
- Hide project roles unless `projectRoleManagement.view`.
- Hide project config unless `projectConfigManagement.view`.
- Hide project members and sent invites unless `projectMemberManagement.view`.

Every protected route should also have a page guard. Navigation hiding is not enough because users can deep-link.

### Phase 5: Gate Action Buttons, Menus, And Workflows

#### Project List And Project Header

| UI action | Permission |
| --- | --- |
| Create project | Workspace `projectManagement.create` |
| Open project detail | Active project membership; no specific permission |
| Edit project | Project `canManageProject` |
| Delete/archive project | Project `canManageProject` |
| View members | Project `projectMemberManagement.view` |
| Assign/invite member | Project `projectMemberManagement.create` |
| Change member role | Project `projectMemberManagement.update` |
| Send project invite | Project `projectMemberManagement.create` |
| Resend project invite | Project `projectMemberManagement.update` |
| Cancel project invite | Project `projectMemberManagement.delete` |
| View sent project invites | Project `projectMemberManagement.view` |
| Accept/decline received invite | Authenticated invitee; no project permission |

#### Task Board, Task List, Task Detail

| UI action | Permission |
| --- | --- |
| View board/list/detail | Project `taskManagement.view` |
| Create task | Project `taskManagement.create` |
| Edit task fields | Project `taskManagement.update` |
| Move task between columns/statuses | Project `taskManagement.update` |
| Drag/drop reorder | Project `taskManagement.update` |
| Assign/unassign members | Project `taskManagement.update` |
| Add/remove labels | Project `taskManagement.update` |
| Add/update/delete comments | Project `taskManagement.update` |
| Add/update/delete checklist groups/items | Project `taskManagement.update` |
| Add/remove watchers | Project `taskManagement.update` |
| Add/update/delete task relations/dependencies | Project `taskManagement.update` |
| Recalculate/update schedule | Project `taskManagement.update` |
| Delete task | Project `taskManagement.delete` |
| Create starter/deliverable task from another task | Project `taskManagement.create` and usually `taskManagement.update` on the source flow |

#### Gantt And Activity Schedule

| UI action | Permission |
| --- | --- |
| View Gantt/activity schedule | Project `taskManagement.view` |
| Export schedule/report | Project `taskManagement.view` unless backend adds a stricter export permission |
| Import schedule rows | Project `taskManagement.update`; require `taskManagement.create` too if import can create tasks |
| Update activity schedule fields | Project `taskManagement.update` |
| Add/update/delete dependencies | Project `taskManagement.update` |

#### Materials And Resource Allocation

| UI action | Permission |
| --- | --- |
| View materials/resource reports | Project `taskManagement.view` |
| Export materials/resource reports | Project `taskManagement.view` |
| Create material/resource allocation | Project `taskManagement.update` |
| Update material/resource allocation | Project `taskManagement.update` |
| Delete material/resource allocation | Project `taskManagement.update` unless backend moves delete to `taskManagement.delete` |
| Import material/resource report rows | Project `taskManagement.update` |

#### Documents

| UI action | Permission |
| --- | --- |
| View task document list/detail | Project `taskManagement.view` in the live backend |
| Preview/download task document attachment | Project `taskManagement.view` in the live backend |
| Create starter document from deliverable | Project `taskManagement.update` in the live backend |
| Upload/create task document | Project `taskManagement.update` in the live backend |
| Edit task document metadata/source fields | Project `taskManagement.update` in the live backend |
| Delete/remove task document | Project `taskManagement.update` in the live backend |
| Standalone project document workflows | Use `documentManagement.*` only when the matching backend endpoint is guarded with `documentManagement.*` |

#### Change Requests

| UI action | Permission |
| --- | --- |
| View change requests | Project `changeRequestManagement.view` |
| Create change request | Project `changeRequestManagement.create` |
| Update/review/approve/reject change request | Project `changeRequestManagement.update` |
| Delete/cancel change request | Project `changeRequestManagement.delete` where backend supports deletion |

#### Workspace Administration

| UI action | Permission |
| --- | --- |
| View users | Workspace `userManagement.view` |
| Create/invite workspace users | Workspace `userManagement.create` |
| Edit users | Workspace `userManagement.update` |
| Update workspace settings | Workspace `userManagement.update` |
| View audit logs | Workspace `userManagement.view` |
| View workspace roles | Workspace `roleManagement.view` |
| Create workspace role | Workspace `roleManagement.create` |
| Update workspace role | Workspace `roleManagement.update` |
| View templates | Workspace `templateManagement.view` |
| Create template | Workspace `templateManagement.create` |
| Update template | Workspace `templateManagement.update` |
| Delete template | Workspace `templateManagement.delete` |

### Phase 6: Enforce Permissions In API Client Calls

Frontend UI hiding should be paired with API-side safety in mutation wrappers:

- Before calling a mutation, check the required permission and short-circuit with a clear toast.
- Keep handling `403` responses globally because permissions can change between render and click.
- On `403`, invalidate current user/workspace/project permission queries and show a consistent "You do not have permission to perform this action" message.
- Avoid optimistic updates for mutations the user might not be allowed to perform.
- Never rely on frontend permissions to decide what data the backend should return.

### Phase 7: Feature Rollout Order

Roll out enforcement in this order:

1. Permission helper module and tests.
2. Auth/workspace/project permission state loading.
3. Global navigation, route guards, and 403 page.
4. Project list/header actions.
5. Task board/list/detail action buttons and overflow menus.
6. Gantt/activity schedule actions.
7. Materials/resource allocation actions.
8. Documents actions.
9. Change request actions.
10. Workspace administration: users, roles, templates, audit logs.
11. Global mutation 403 handling and query invalidation polish.

This order protects the most common production paths first while giving later modules a stable permission API to reuse.

## Testing Checklist

Create fixtures for these roles:

- Workspace admin/full access.
- Workspace member without `projectManagement.create`.
- Workspace member with templates view only.
- Project owner/manager with granular project role/config/member management.
- Project contributor with task create/update/view but no delete.
- Project reviewer with update/view and no create/delete.
- Project viewer with `taskManagement.viewScope = 'assigned'`.
- Project role with no document access.
- Project role with no change request access.

Required tests:

- Permission helpers return `false` on missing matrices.
- Navigation hides unauthorized sections.
- Direct route visits show 403 when unauthorized.
- Create/edit/delete buttons are hidden for missing permissions.
- Overflow menu trigger disappears when all menu items are unauthorized.
- Bulk action toolbar hides forbidden actions.
- Drag/drop task movement is blocked without `taskManagement.update`.
- `canManageProject` gates project settings and delete/archive.
- Granular project-admin domains gate project roles, project config, project members, and sent project invites.
- `taskManagement.viewScope = 'assigned'` does not show all-project wording/counts.
- Global API client handles `403` and refreshes permission context.

## Acceptance Criteria

The frontend implementation is production-ready when:

- All protected backend routes have a matching frontend guard or action gate.
- Workspace and project permissions are checked through shared helpers only.
- Buttons, dropdown menu items, tabs, bulk actions, keyboard shortcuts, drag/drop, and empty-state CTAs respect permissions.
- Deep links to unauthorized screens produce a 403 page.
- The UI defaults to no access while permission context is loading.
- A backend `403` is handled gracefully and refreshes local permission state.
- Tests cover helper logic plus at least one representative UI surface per module.
