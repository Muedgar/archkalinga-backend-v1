# Project Admin Permissions Implementation Plan

## Objective

Implement granular project-scoped permissions for:

- Project roles
- Project configuration: statuses, priorities, severities, task types, labels
- Project members and project invites

This plan is based on `docs/project-admin-permissions-study.md`. The implementation should preserve task permissions and task assignment behavior.

## Target Permission Domains

Add these domains to `ProjectPermissionMatrix`:

```ts
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
```

Keep `canManageProject` during the rollout as a compatibility umbrella. New controller decorators should use the granular domains.

## Product Defaults

Use these defaults unless product decides otherwise:

| Role | Project Role Management | Project Config Management | Project Member Management |
| --- | --- | --- | --- |
| Owner | full | full | full |
| Manager | create, update, view, delete | create, update, view, delete | create, update, view, delete |
| Contributor | none | view | view |
| Reviewer | none | view | view |
| Viewer | none | view | none |

Rationale:

- Owners and managers keep the current effective admin capability.
- Contributors and reviewers can still render task UI that depends on config values.
- Viewers can render task config but cannot browse project members.
- Member view remains enabled for contributors/reviewers because active collaboration views commonly need assignee/member pickers.

## Phase 1: Extend Project Permission Types

Files:

- `src/projects/types/project-permission-matrix.type.ts`

Changes:

- Add the three new domains to `PROJECT_PERMISSION_DOMAINS`.
- Add the three domains to `ProjectPermissionMatrix`.
- Add a reusable action shape type if helpful:

```ts
export type ProjectCrudPermissionSet = {
  create: boolean;
  update: boolean;
  view: boolean;
  delete: boolean;
};
```

- Update all preset matrices:
  - `FULL_PROJECT_ACCESS_MATRIX`
  - `MANAGE_PROJECT_ACCESS_MATRIX`
  - `CONTRIBUTOR_PROJECT_ACCESS_MATRIX`
  - `REVIEWER_PROJECT_ACCESS_MATRIX`
  - `VIEWER_PROJECT_ACCESS_MATRIX`
  - `EMPTY_PROJECT_ACCESS_MATRIX`
- Update comments that currently say project roles/config/members are governed only by `canManageProject`.

Acceptance checks:

- TypeScript accepts `@RequireProjectPermission('projectRoleManagement', 'view')`.
- Empty matrix includes all new domains with all booleans false.

## Phase 2: Deep Normalize Project Role Permissions

Files:

- `src/projects/project-roles.service.ts`
- `src/projects/dtos/create-project-role.dto.ts`

Changes:

- Change `CreateProjectRoleDto.permissions` type to `Partial<ProjectPermissionMatrix>` while keeping validation as `@IsObject()`.
- Replace the current shallow `mergePermissions` with a deep merge across all nested domains.
- Ensure unknown top-level keys are not required for compatibility, but known domains always get complete defaults.

Implementation detail:

```ts
private mergeCrudPermissions<T extends Record<string, boolean>>(
  defaults: T,
  incoming?: Partial<T>,
): T {
  return { ...defaults, ...incoming };
}
```

Then use it for every nested permission group.

Acceptance checks:

- Creating a custom role with `{ projectConfigManagement: { view: true } }` stores create/update/delete as false.
- Existing payloads that only contain current domains still work.

## Phase 3: Add Migration for Existing Project Roles

Files:

- `src/migrations/<timestamp>-add-project-admin-permission-domains.ts`

Changes:

- Backfill `project_roles.permissions` JSONB with all three domains.
- Preserve `canManageProject`.
- Backfill rules:
  - `canManageProject = true` grants full permissions for all three new domains.
  - `taskManagement.view = true` grants `projectConfigManagement.view = true`.
  - Contributor/reviewer can get `projectMemberManagement.view = true` if slug is `contributor` or `reviewer`.
  - Viewer keeps `projectMemberManagement.view = false`.
  - All missing actions default to false.

Suggested migration class:

```ts
export class AddProjectAdminPermissionDomains1788800000000
  implements MigrationInterface
{
  name = 'AddProjectAdminPermissionDomains1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`...`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "project_roles"
      SET "permissions" =
        "permissions"
        - 'projectRoleManagement'
        - 'projectConfigManagement'
        - 'projectMemberManagement'
    `);
  }
}
```

Acceptance checks:

- Owner and Manager roles gain full new domains.
- Contributor and Reviewer gain config view and member view.
- Viewer gains config view only.
- No existing `canManageProject` value changes.

## Phase 4: Update Controller Authorization

### Project Role Routes

File:

- `src/projects/project-roles.controller.ts`

Replace:

- `canManageProject` checks

With:

- `POST /projects/:projectId/roles` -> `projectRoleManagement.create`
- `GET /projects/:projectId/roles` -> `projectRoleManagement.view`
- `GET /projects/:projectId/roles/:roleId` -> `projectRoleManagement.view`
- `PATCH /projects/:projectId/roles/:roleId` -> `projectRoleManagement.update`
- `DELETE /projects/:projectId/roles/:roleId` -> `projectRoleManagement.delete`

### Project Config Routes

File:

- `src/projects/project-config.controller.ts`

Replace:

- list/get `taskManagement.view`
- create/update/delete `canManageProject`

With:

- list/get -> `projectConfigManagement.view`
- create -> `projectConfigManagement.create`
- update -> `projectConfigManagement.update`
- delete -> `projectConfigManagement.delete`

Apply to statuses, priorities, severities, task types, and labels.

### Project Member Routes

File:

- `src/projects/projects.controller.ts`

Replace:

- `GET /projects/:projectId/members`: `taskManagement.view` -> `projectMemberManagement.view`
- `POST /projects/:projectId/members/assign`: `canManageProject` -> `projectMemberManagement.create`
- `PATCH /projects/:projectId/members/:memberId/role`: `canManageProject` -> `projectMemberManagement.update`

Keep project update/delete using `canManageProject` for this iteration unless product asks for `projectSettingsManagement`.

### Project Invite Routes

File:

- `src/project-invites/project-invites.controller.ts`

Replace:

- `POST /project-invites`: `projectMemberManagement.create`
- `GET /projects/:projectId/invites`: `projectMemberManagement.view`
- `POST /project-invites/:inviteId/resend`: `projectMemberManagement.update`
- `POST /project-invites/:inviteId/cancel`: `projectMemberManagement.delete`

Invite context:

- `ProjectPermissionGuard` resolves project context from `params.inviteId` for invite resend/cancel routes.
- The invite's own `projectId` is authoritative for authorization, so clients do not need to send `projectId` separately for those routes.

## Phase 5: Guard and Workspace Fallback Review

Files:

- `src/auth/guards/project-permission.guard.ts`
- `src/auth/decorators/require-project-permission.decorator.ts`

Expected code impact:

- The decorator type should work once the new domains are in `ProjectPermissionDomain`.
- The guard already checks `permissions[domain][action]` generically.

Review workspace fallback:

- Keep workspace admin bypass.
- Keep workspace `projectManagement.view/update/delete` fallback for project-scoped admin actions.
- For `create`, use workspace `projectManagement.update` fallback because workspace `projectManagement.create` means create a project, not create project sub-resources.

Acceptance checks:

- Workspace admin can still perform project admin actions.
- Project member with granular permission can perform the action without `canManageProject`.
- Project member with only `canManageProject` still works during rollout if compatibility is retained.

## Phase 6: DTO and API Documentation Updates

Files:

- `src/projects/dtos/create-project-role.dto.ts`
- `FRONTEND_API_REFERENCE.md`
- possibly `docs/frontend-permissions-enforcement-plan.md`

Changes:

- Update Swagger description and examples to include:
  - `projectRoleManagement`
  - `projectConfigManagement`
  - `projectMemberManagement`
- Describe `canManageProject` as legacy/umbrella compatibility for project settings.
- Update frontend reference permission table.

Acceptance checks:

- Swagger generated from DTO shows new permission matrix.
- Frontend docs no longer tell clients to use `canManageProject` for roles/config/members.

## Phase 7: Tests

Primary target:

- Add focused guard/controller/service tests if the project already has a good test harness for permissions.
- If not, add service-level tests around matrix normalization and migration behavior, then manually verify guarded endpoints.

Test cases:

- A role with `projectRoleManagement.view` can list roles but cannot update roles.
- A role with `projectConfigManagement.view` can list labels/statuses without `taskManagement.view`.
- A role with `taskManagement.view` but no `projectConfigManagement.view` cannot list config after strict decorator change.
- A role with `projectMemberManagement.view` can list members.
- A role with `taskManagement.update` but no `projectMemberManagement.update` cannot change member roles.
- A role with `projectMemberManagement.create` can assign/invite project members.
- Owner/Manager seeded roles retain old admin behavior.
- Partial permission payloads deep-merge correctly.

Commands:

```bash
npm run build
npm run test
```

If database-backed checks are added:

```bash
npm run migration:run
npm run test:e2e
```

## Phase 8: Rollout

Backend rollout:

1. Deploy migration and backend code together.
2. Keep `canManageProject` in matrices and guard compatibility.
3. Confirm existing Owner/Manager roles still pass project admin flows.
4. Confirm non-admin roles have expected config/member visibility.

Frontend rollout:

1. Replace checks for roles/settings/member UI:
   - `canManageProject`
   - `taskManagement.view` for config/member reads
2. Use new granular domains:
   - `projectRoleManagement.*`
   - `projectConfigManagement.*`
   - `projectMemberManagement.*`
3. Temporarily fallback to `canManageProject` for older backend responses:

```ts
const canUpdateProjectConfig =
  permissions.projectConfigManagement?.update === true ||
  permissions.canManageProject === true;
```

Cleanup rollout:

- After all clients use the new domains, hide `canManageProject` in role editing UI or mark it as project settings only.
- Consider a future `projectSettingsManagement` domain for project title/status/date/archive/delete actions.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing roles miss new JSON keys | Add migration and deep normalizer |
| Frontend loses access to config needed for task screens | Grant config view to task-view roles and update frontend checks |
| Invite resend/cancel lacks route project context | Resolve project context from `inviteId` inside `ProjectPermissionGuard` |
| Workspace fallback becomes too permissive | Keep current behavior first, then tighten in a separate product decision |
| Partial permission payload overwrites nested defaults | Use deep merge normalization |

## Definition of Done

- New domains exist in `ProjectPermissionMatrix` and all default matrices.
- Existing project roles are backfilled.
- Role, config, member, and invite routes use granular permissions.
- DTO and frontend API docs show the new matrix.
- Build passes.
- Permission behavior is covered by tests or documented manual verification.
- `canManageProject` remains available for backward compatibility but is no longer the primary gate for roles/config/members.
