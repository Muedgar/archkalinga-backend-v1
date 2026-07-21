# Project Admin Permissions Study

## Goal

Split the current broad project admin permission into separate project-scoped permissions for:

- Project roles
- Project configuration, including statuses, priorities, severities, task types, and labels
- Project members and member role assignment

These permissions must govern project resources, not task assignment. Task assignment and task visibility should continue to use the existing task permission model.

## Current State

Project permissions are defined in `src/projects/types/project-permission-matrix.type.ts`.

The matrix currently has:

- `canManageProject`: broad project admin flag
- `taskManagement`
- `documentManagement`
- `changeRequestManagement`

`canManageProject` is currently used for many different actions:

- Updating/deleting a project in `src/projects/projects.controller.ts`
- Assigning members and changing member roles in `src/projects/projects.controller.ts`
- Creating, listing, updating, and deleting project roles in `src/projects/project-roles.controller.ts`
- Creating, updating, and deleting project config items in `src/projects/project-config.controller.ts`
- Creating, listing, resending, and cancelling project invites in `src/project-invites/project-invites.controller.ts`

Read access is inconsistent:

- Project config reads currently require `taskManagement.view`.
- Project members currently require `taskManagement.view`.
- Project roles currently require `canManageProject` with workspace fallback to `projectManagement.view`.

That means users who can see tasks can also list labels/statuses and project members, but users need admin-level access to view roles. The requested change is to make these explicit project-resource permissions instead of relying on task permissions.

## Recommended Permission Model

Add three resource domains to `ProjectPermissionMatrix`:

```ts
projectRoleManagement:   { create: boolean; update: boolean; view: boolean; delete: boolean };
projectConfigManagement: { create: boolean; update: boolean; view: boolean; delete: boolean };
projectMemberManagement: { create: boolean; update: boolean; view: boolean; delete: boolean };
```

Recommended meaning:

- `projectRoleManagement`: create/list/read/update/delete project roles.
- `projectConfigManagement`: create/list/read/update/delete statuses, priorities, severities, task types, and labels.
- `projectMemberManagement`: list members, add/invite members, update member roles, deactivate/remove members when that endpoint exists.

Keep `canManageProject` initially as a compatibility umbrella for existing roles and old clients. New code should prefer the specific domains.

Optional later split:

- `projectInviteManagement` if invite permissions need to differ from member permissions.
- `projectSettingsManagement` if updating project title/status/dates should differ from member/config/role administration.

For now, project invites can reasonably be covered by `projectMemberManagement` because invite creation is the path for adding a project member.

## Default Role Matrix

Update the default project role constants in `src/projects/types/project-permission-matrix.type.ts`.

Suggested defaults:

| Role | Role Mgmt | Config Mgmt | Member Mgmt | Notes |
| --- | --- | --- | --- | --- |
| Owner | full | full | full | Full control |
| Manager | view/update/create, no delete or full depending product policy | full except delete if conservative | create/update/view | Mirrors current `canManageProject` but can be tuned |
| Contributor | view false or true for roles | view config | view members | Avoids task-only users needing admin rights |
| Reviewer | view false or true for roles | view config | view members | Same as contributor unless product wants stricter |
| Viewer | view false for roles | view config | view members false or true | If labels/statuses must render in task UI, grant config view |

Important product decision:

- If labels/statuses are needed to render task views, give `projectConfigManagement.view = true` to every role with `taskManagement.view = true`.
- If the member list is considered sensitive, keep `projectMemberManagement.view = false` for Viewer and expose only assigned users through task detail endpoints.

## Controller Mapping

Update route decorators to use the new domains.

### Project roles

File: `src/projects/project-roles.controller.ts`

- `POST /projects/:projectId/roles` -> `projectRoleManagement.create`
- `GET /projects/:projectId/roles` -> `projectRoleManagement.view`
- `GET /projects/:projectId/roles/:roleId` -> `projectRoleManagement.view`
- `PATCH /projects/:projectId/roles/:roleId` -> `projectRoleManagement.update`
- `DELETE /projects/:projectId/roles/:roleId` -> `projectRoleManagement.delete`

### Project config

File: `src/projects/project-config.controller.ts`

For each config resource: statuses, priorities, severities, task types, labels.

- list/get -> `projectConfigManagement.view`
- create -> `projectConfigManagement.create`
- patch -> `projectConfigManagement.update`
- delete -> `projectConfigManagement.delete`

This replaces the current mix of `taskManagement.view` for reads and `canManageProject` for writes.

### Project members

File: `src/projects/projects.controller.ts`

- `GET /projects/:projectId/members` -> `projectMemberManagement.view`
- `POST /projects/:projectId/members/assign` -> `projectMemberManagement.create`
- `PATCH /projects/:projectId/members/:memberId/role` -> `projectMemberManagement.update`

If a remove/deactivate member endpoint is added later, use `projectMemberManagement.delete`.

### Project invites

File: `src/project-invites/project-invites.controller.ts`

Recommended initial mapping:

- `POST /project-invites` -> `projectMemberManagement.create`
- `GET /projects/:projectId/invites` -> `projectMemberManagement.view`
- `POST /project-invites/:inviteId/resend` -> `projectMemberManagement.update`
- `POST /project-invites/:inviteId/cancel` -> `projectMemberManagement.delete` or `update`

The invite routes that accept/decline received invites should stay user-owned and not require project admin permissions.

## Guard Changes

`src/auth/decorators/require-project-permission.decorator.ts`

- Extend the decorator type by adding the new domains to `ProjectPermissionDomain`.
- No decorator API shape needs to change.

`src/auth/guards/project-permission.guard.ts`

- The generic domain/action logic already supports any domain in the matrix.
- Keep the `canManageProject` branch for compatibility.
- Update comments and Swagger descriptions so new routes do not describe everything as project settings.

Workspace fallback:

- Today, workspace roles with `projectManagement.view/update/delete` can bypass project permission checks.
- Keep that behavior for now unless the product wants strict project-only administration.
- For specific project domains, map workspace fallback by action:
  - `projectRoleManagement.view` -> workspace `projectManagement.view`
  - `projectRoleManagement.update/create/delete` -> workspace `projectManagement.update/delete` as appropriate
  - same for config/member domains

## Permission Normalization

`src/projects/project-roles.service.ts` currently merges incoming permissions with `EMPTY_PROJECT_ACCESS_MATRIX` using a shallow spread. With new nested domains, that is still fragile because partial nested objects can overwrite defaults.

Implement a deep normalizer:

```ts
private mergePermissions(
  permissions?: Partial<ProjectPermissionMatrix>,
): ProjectPermissionMatrix {
  return {
    ...EMPTY_PROJECT_ACCESS_MATRIX,
    ...permissions,
    taskManagement: {
      ...EMPTY_PROJECT_ACCESS_MATRIX.taskManagement,
      ...permissions?.taskManagement,
    },
    documentManagement: {
      ...EMPTY_PROJECT_ACCESS_MATRIX.documentManagement,
      ...permissions?.documentManagement,
    },
    changeRequestManagement: {
      ...EMPTY_PROJECT_ACCESS_MATRIX.changeRequestManagement,
      ...permissions?.changeRequestManagement,
    },
    projectRoleManagement: {
      ...EMPTY_PROJECT_ACCESS_MATRIX.projectRoleManagement,
      ...permissions?.projectRoleManagement,
    },
    projectConfigManagement: {
      ...EMPTY_PROJECT_ACCESS_MATRIX.projectConfigManagement,
      ...permissions?.projectConfigManagement,
    },
    projectMemberManagement: {
      ...EMPTY_PROJECT_ACCESS_MATRIX.projectMemberManagement,
      ...permissions?.projectMemberManagement,
    },
  };
}
```

This prevents a payload like `{ projectConfigManagement: { view: true } }` from losing create/update/delete defaults.

## Migration and Backfill

Add a migration that updates existing `project_roles.permissions`.

Backfill rule:

- If `permissions.canManageProject = true`, grant create/update/view/delete for the three new domains.
- If `taskManagement.view = true`, grant `projectConfigManagement.view = true` so task UI can still render statuses/labels.
- Decide whether to grant `projectMemberManagement.view = true` to non-admin task viewers. A conservative default is false unless current frontend depends on the member list.
- Set all missing booleans to false.

Example SQL shape:

```sql
UPDATE project_roles
SET permissions = jsonb_set(
  jsonb_set(
    jsonb_set(
      permissions,
      '{projectRoleManagement}',
      CASE WHEN (permissions->>'canManageProject')::boolean IS TRUE
        THEN '{"create":true,"update":true,"view":true,"delete":true}'::jsonb
        ELSE '{"create":false,"update":false,"view":false,"delete":false}'::jsonb
      END,
      true
    ),
    '{projectConfigManagement}',
    CASE WHEN (permissions->>'canManageProject')::boolean IS TRUE
      THEN '{"create":true,"update":true,"view":true,"delete":true}'::jsonb
      WHEN (permissions->'taskManagement'->>'view')::boolean IS TRUE
      THEN '{"create":false,"update":false,"view":true,"delete":false}'::jsonb
      ELSE '{"create":false,"update":false,"view":false,"delete":false}'::jsonb
    END,
    true
  ),
  '{projectMemberManagement}',
  CASE WHEN (permissions->>'canManageProject')::boolean IS TRUE
    THEN '{"create":true,"update":true,"view":true,"delete":true}'::jsonb
    ELSE '{"create":false,"update":false,"view":false,"delete":false}'::jsonb
  END,
  true
);
```

Use a timestamped migration under `src/migrations`.

## DTO and Swagger Updates

Update `src/projects/dtos/create-project-role.dto.ts`.

- Replace the `canManageProject`-centric description with the new domains.
- Show the new domains in the example permission matrix.
- Prefer typing permissions as `Partial<ProjectPermissionMatrix>` if validation remains loose.

`UpdateProjectRoleDto` can stay as `PartialType(CreateProjectRoleDto)`.

## Frontend Impact

Frontend permission checks should move from:

- `role.permissions.canManageProject`
- `role.permissions.taskManagement.view` for config/member reads

To:

- `role.permissions.projectRoleManagement.*`
- `role.permissions.projectConfigManagement.*`
- `role.permissions.projectMemberManagement.*`

The backend serializers already return the full `permissions` JSON, so no serializer shape change is needed.

During migration, frontend can support both:

```ts
const canUpdateConfig =
  permissions.projectConfigManagement?.update === true ||
  permissions.canManageProject === true;
```

After backend and frontend are both deployed, the fallback can be removed.

## Testing Plan

Add or update tests for:

- Project roles:
  - user with only `projectRoleManagement.view` can list/get roles
  - user without it cannot list/get roles
  - user with `projectRoleManagement.update` can update but cannot delete without delete
- Project config:
  - task viewer without config view cannot list config if product chooses strict config view
  - config viewer can list labels/statuses without task update permissions
  - config updater cannot manage members or roles
- Project members:
  - member viewer can list members without `taskManagement.view`
  - member updater can change role
  - task updater cannot change member role unless it also has member permission
- Migration:
  - existing Owner/Manager permissions gain all new domains
  - existing task viewers preserve config read if that compatibility rule is chosen

## Implementation Order

1. Extend `ProjectPermissionMatrix` with the three new domains and update all preset matrices.
2. Add a deep permission normalizer in `ProjectRolesService`.
3. Add the migration to backfill existing `project_roles.permissions`.
4. Replace decorators in role/config/member/invite controllers.
5. Update DTO Swagger examples and frontend API docs.
6. Add focused authorization tests.
7. Deploy backend first with `canManageProject` compatibility still present.
8. Update frontend permission checks.
9. Later, remove or hide `canManageProject` from new UI if product wants fully granular administration.

## Recommendation

Implement the three-domain split now and keep `canManageProject` only as a backward-compatible umbrella. This gives the product the requested separation without destabilizing the existing task permission model or project membership access rules.

