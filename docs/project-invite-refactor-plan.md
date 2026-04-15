# Project Creation & Invite Refactor — Implementation Plan

## What This Plan Covers

Three interconnected changes that bring the backend in line with the new product flow:

1. **Strip project creation down to owner-only** — no members in the create DTO
2. **Switch invites from email-based to userId-based, project-scoped only** — no task/subtask context, no auto-assign
3. **Add public profile/workspace concept + new user search endpoint** — so users can be found before being invited

---

## Current State vs New Direction

| Area | Current | New |
|------|---------|-----|
| `CreateProjectDto` | Has `memberIds` + `memberAssignments` | Project details + `templateId` only |
| Creator membership | Comes from request (correct) | Stays from request |
| Extra members at creation | Resolved from DTO + added in transaction | Removed — members come via invites only |
| `CreateProjectInviteDto` | `inviteeEmail` + task/subtask scope fields | `inviteeUserId` (UUID), project-scope only |
| `ProjectInvite` entity | `inviteeEmail` (non-null), task fields | `inviteeUserId` (non-null), task fields dropped |
| `acceptInvite` | Checks email, auto-assigns to task | Looks up user by ID, no task assignment |
| User discoverability | No search, no public concept | `isPublicProfile` on User + `allowPublicProfiles` on Workspace |
| User search | None | New `GET /users/search` endpoint |

---

## Step 1 — Strip `CreateProjectDto` of Member Fields

**Files:** `src/projects/dtos/create-project.dto.ts`, `src/projects/dtos/member-role-assignment.dto.ts`, `src/projects/projects.service.ts`

### DTO changes

Remove from `CreateProjectDto`:
- `memberIds?: string[]`
- `memberAssignments?: MemberRoleAssignmentDto[]`

The `MemberRoleAssignmentDto` file can be deleted since it will no longer be used at project creation. (It may resurface later for a dedicated member-management endpoint.)

New minimal shape:
```ts
export class CreateProjectDto {
  title: string;
  description: string;
  startDate: string;
  endDate?: string;
  type: ProjectType;
  templateId: string;
}
```

### Service changes (`createProject` method)

Remove:
- `normalizeMemberAssignments(dto)` private method
- `resolveMemberAssignments(...)` private method (and its dependency on `workspaceRepo` for member lookups)
- The `nonCreatorMembers` loop and its `tx.save(ProjectMembership {...})` block
- The `memberCount` field in the activity log `actionMeta` (or keep it as `1` — just the owner)

Keep:
- `ensureDefaultProjectRoles` (seeds all 5 roles — unchanged)
- Owner membership creation (from `requestUser.id`)
- Template seeding, workflow column seeding, activity log

### Service changes (`updateProject` method)

Remove the block that handles `dto.memberIds !== undefined || dto.memberAssignments !== undefined` — the member sync logic inside `updateProject`. Project membership is now managed exclusively via the invite flow.

Also remove from `UpdateProjectDto`:
- `memberIds?: string[]`
- `memberAssignments?: MemberRoleAssignmentDto[]`

---

## Step 2 — Add Public Profile Concept to User and Workspace

**Files:** `src/users/entities/user.entity.ts`, `src/workspaces/entities/workspace.entity.ts`

### User entity

Add one boolean column:

```ts
/**
 * When true, this user's profile (name, title, workspace) is visible
 * to authenticated users searching for people to invite.
 */
@Column({ type: 'boolean', nullable: false, default: false })
isPublicProfile: boolean;
```

Default `false` — users opt in, or an admin sets it.

### Workspace entity

Add one boolean column:

```ts
/**
 * When true, all members of this workspace are discoverable by other
 * authenticated users (respects individual isPublicProfile override
 * if it is explicitly set to false).
 */
@Column({ type: 'boolean', nullable: false, default: false })
allowPublicProfiles: boolean;
```

**Visibility rule:**
A user is searchable if:
- `user.isPublicProfile = true`, OR
- `workspace.allowPublicProfiles = true` AND `user.isPublicProfile` is not explicitly `false`

The simplest safe implementation: a user appears in search results if `user.isPublicProfile = true` OR their workspace has `allowPublicProfiles = true`. If individual override is needed later, it can be added.

---

## Step 3 — New User Search Endpoint

**Files:** New `GET /users/search` in `src/users/users.controller.ts` + `src/users/users.service.ts`

### Endpoint

```
GET /users/search?q=searchTerm&excludeProjectId=uuid&page=1&limit=20
```

Auth: JWT required. No specific workspace permission — any authenticated user can search.

### Query params

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | Yes (min 2 chars) | Searched against `firstName`, `lastName`, full name, `userName`, `email`, workspace `name`/`slug` |
| `excludeProjectId` | UUID | Optional | Filters out users who are already active members of this project |
| `page` | number | Optional | Default 1 |
| `limit` | number | Optional | Default 20, max 50 |

### Query logic

```sql
SELECT u.*, w.name AS workspaceName, w.slug AS workspaceSlug
FROM users u
JOIN workspace_members wm ON wm.user_id = u.id
JOIN workspaces w ON w.id = wm.workspace_id
WHERE (u.is_public_profile = true OR w.allow_public_profiles = true)
  AND u.status = true
  AND (
    LOWER(u.first_name || ' ' || u.last_name) LIKE :q
    OR LOWER(u.user_name) LIKE :q
    OR LOWER(u.email) LIKE :q
    OR LOWER(w.name) LIKE :q
    OR LOWER(w.slug) LIKE :q
  )
  -- optional
  AND u.id NOT IN (
    SELECT pm.user_id FROM project_memberships pm
    WHERE pm.project_id = :excludeProjectId AND pm.status = 'ACTIVE'
  )
ORDER BY u.first_name, u.last_name
LIMIT :limit OFFSET :offset
```

### Response shape

```json
{
  "items": [
    {
      "id": "user-uuid",
      "firstName": "Jane",
      "lastName": "Doe",
      "userName": "janedoe",
      "email": "jane@example.com",
      "title": "Senior Architect",
      "workspace": {
        "id": "workspace-uuid",
        "name": "Acme Design Studio",
        "slug": "acme-design-studio"
      }
    }
  ],
  "count": 1,
  "page": 1,
  "pages": 1,
  "limit": 20
}
```

### DTO

```ts
export class UserSearchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @IsUUID()
  @IsOptional()
  excludeProjectId?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 20;
}
```

---

## Step 4 — Rework the Invite Flow

### 4a. `CreateProjectInviteDto`

**Remove:**
- `inviteeEmail`
- `taskId`
- `subtaskId`
- `autoAssignOnAccept`
- `message` (optional — keep if UI still uses it, defer removal)

**Add:**
- `inviteeUserId: string` — UUID of the user found via the search endpoint

New shape:
```ts
export class CreateProjectInviteDto {
  @IsUUID()
  projectId: string;

  @IsUUID()
  inviteeUserId: string;

  @IsUUID()
  projectRoleId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
```

### 4b. `ProjectInvite` entity

**Remove columns:**
- `inviteeEmail` (varchar, non-null) → replaced by non-null `inviteeUserId`
- `taskId`
- `subtaskId`
- `targetType` (and `InviteTargetType` enum if nothing else uses it)
- `targetName`
- `autoAssignOnAccept`
- `projectName` (denormalized — can be re-derived from the relation when needed)

**Change:**
- `inviteeUserId` becomes `NOT NULL` (currently nullable)
- `inviteeUser` relation becomes required (remove `nullable: true`)

**Keep:**
- `inviterUserId` / `inviterUser`
- `projectRoleId` / `projectRole`
- `projectId` / `project`
- `token`, `status`, `expiresAt`, `acceptedAt`
- `message`

### 4c. `ProjectInvitesService.createInvite`

**Remove:**
- Email-based user lookup (`existingByEmail`)
- Task repo injection + task/subtask validation block
- `TaskAssignee` repo injection
- Duplicate check by `taskId`/`subtaskId` — simplify to: one pending invite per `(projectId, inviteeUserId)`
- `targetType`, `targetName`, `autoAssignOnAccept` assignments

**Add:**
- Look up `inviteeUser` by `dto.inviteeUserId` — throw `NotFoundException` if not found
- Guard: if invitee is already an active member of the project, throw `ConflictException`
- Guard: if a pending invite already exists for this `(projectId, inviteeUserId)`, throw `ConflictException`

**Simplified flow:**
```
1. Assert requester is project member (existing guard — unchanged)
2. Load project
3. Load + validate projectRole (must belong to project, must be active)
4. Load inviteeUser by inviteeUserId — throw 404 if not found
5. Assert invitee is not already an active member
6. Assert no duplicate PENDING invite for same (projectId, inviteeUserId)
7. Create invite record in transaction + write activity log
8. Return serialized invite
```

### 4d. `ProjectInvitesService.acceptInvite`

**Remove:**
- "User hasn't signed up yet" fallback (user must exist — we verified at invite creation)
- `autoAssignOnAccept` block and `TaskAssignee` creation
- Task/subtask context from the return payload

**Simplified return:**
```ts
{
  projectId: string;
  inviteId: string;
  message: string | null;
  membership: {
    id: string;
    status: MembershipStatus;
    projectRoleId: string;
    projectRole: { id, name, slug, status, isSystem, isProtected, permissions } | null;
  };
}
```

### 4e. `InviteFiltersDto`

Remove `taskId` and `subtaskId` filter params. Keep `status`, `page`, `limit`.

### 4f. `ProjectInviteSerializer` and `PendingInviteSnippetSerializer`

Remove exposed fields:
- `inviteeEmail`
- `taskId`, `subtaskId`, `targetType`, `targetName`
- `autoAssignOnAccept`
- `projectName`

Add:
- `inviteeUserId`
- Optionally a nested `inviteeUser` snippet (id, firstName, lastName, email, title)

---

## Step 5 — Database Migration

One new migration covering all schema changes:

```ts
// migration name: project-invite-user-search-refactor

// users table
ALTER TABLE users ADD COLUMN is_public_profile BOOLEAN NOT NULL DEFAULT FALSE;

// workspaces table
ALTER TABLE workspaces ADD COLUMN allow_public_profiles BOOLEAN NOT NULL DEFAULT FALSE;

// project_invites table
-- Make invitee_user_id non-nullable (must already be set on existing rows before this runs;
-- if there are rows with null invitee_user_id, backfill or handle with a default)
ALTER TABLE project_invites ALTER COLUMN invitee_user_id SET NOT NULL;
ALTER TABLE project_invites ALTER COLUMN invitee_user_id SET DEFAULT NULL; -- remove after NOT NULL

-- Drop email and task-context columns
ALTER TABLE project_invites DROP COLUMN IF EXISTS invitee_email;
ALTER TABLE project_invites DROP COLUMN IF EXISTS task_id;
ALTER TABLE project_invites DROP COLUMN IF EXISTS subtask_id;
ALTER TABLE project_invites DROP COLUMN IF EXISTS target_type;
ALTER TABLE project_invites DROP COLUMN IF EXISTS target_name;
ALTER TABLE project_invites DROP COLUMN IF EXISTS auto_assign_on_accept;
ALTER TABLE project_invites DROP COLUMN IF EXISTS project_name;

-- Add unique constraint: one pending invite per (project, invitee)
-- Note: this can't be a simple UNIQUE because PENDING is a status value.
-- Use a partial unique index instead:
CREATE UNIQUE INDEX uq_invite_pending_per_project_user
  ON project_invites (project_id, invitee_user_id)
  WHERE status = 'PENDING';
```

> **Important:** Before making `invitee_user_id` NOT NULL, check if any existing rows have a null value and handle them (delete test records, or backfill from `invitee_email` while users exist).

---

## Step 6 — Module Wiring Cleanup

### `ProjectInvitesModule`

Remove from imports/providers:
- `Task` entity from `forFeature`
- `TaskAssignee` entity from `forFeature`
- Corresponding repo injections in the service constructor

### `UsersModule`

Add the new `UserSearchDto` and wire the search endpoint into the controller + service. No new module needed.

---

## Delivery Order

| # | What | Why |
|---|------|-----|
| 1 | Migration (add columns, drop invite columns) | Everything else depends on schema |
| 2 | Strip `CreateProjectDto` + clean up `createProject` service | Self-contained, no entity changes |
| 3 | Add `isPublicProfile` to User entity, `allowPublicProfiles` to Workspace entity | Required for search |
| 4 | New `GET /users/search` endpoint | Frontend needs this to pick invitees |
| 5 | Rework `ProjectInvite` entity | Entity-level change |
| 6 | Rework `CreateProjectInviteDto` + service + serializer | Depends on entity |
| 7 | Clean up module wiring (remove Task/TaskAssignee from invites module) | Final cleanup |

---

## What Is Explicitly Deferred

- **Task/subtask-scoped invites** — will be a separate flow, not part of the project invite system
- **`autoAssignOnAccept`** — deferred with task invites
- **Profile editing endpoint** (to set `isPublicProfile`)  — user can set their own visibility; implement alongside or after search
- **Workspace settings endpoint** (to set `allowPublicProfiles`) — workspace admin concern, separate from this refactor
