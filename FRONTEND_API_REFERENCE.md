# ArchKalinga API Reference — Project Create, Invites & Discovery Flow

> Generated from the latest backend implementation.
> Base URL: `/api` (or whatever prefix is configured).
> All authenticated endpoints require `Authorization: Bearer <access_token>`.
> Workspace-scoped endpoints also require the `X-Workspace-Id: <workspaceId>` header.

---

## Auth conventions

| Header | Required on |
|--------|-------------|
| `Authorization: Bearer <token>` | Every authenticated endpoint |
| `X-Workspace-Id: <uuid>` | All `/users/*` endpoints (uses WorkspaceGuard) |

Invite model summary:

- **Workspace invites** add a user to a workspace and assign a selected `WorkspaceRole`.
- **Project invites** add a user to a project and assign a selected `ProjectRole`.
- Accepting a project invite also ensures the invitee has workspace access as a minimal workspace `Guest`, so project routes that require workspace context continue to work.
- Accepting a workspace invite does **not** create project membership.

Project permission domain summary:

| Domain | Frontend use |
|--------|--------------|
| `canManageProject` | Project settings/update/delete and rollout fallback for granular project-admin permissions |
| `projectRoleManagement.*` | Project role list/create/update/delete |
| `projectConfigManagement.*` | Project statuses, priorities, severities, task types, and labels |
| `projectMemberManagement.*` | Project members and sent project invites |
| `taskManagement.*` | Tasks, subtasks, task board/list/detail, and task-owned operations |

---

## 1. Create a Project

**`POST /projects`**
Auth: JWT + `X-Workspace-Id`
Permission: `projectManagement.create` on the caller's workspace role

The creator is automatically made the **Owner** of the project — no member fields in the body. All 5 default project roles (Owner, Manager, Contributor, Reviewer, Viewer) are seeded per-project on creation.

### Request body
```json
{
  "title": "Office Tower Fit-Out",
  "description": "Phase 2 interior works",
  "startDate": "2026-05-01",
  "endDate": "2026-09-30",
  "type": "CONSTRUCTION",
  "templateId": "uuid-optional"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string | ✅ | |
| `description` | string | ✅ | |
| `startDate` | ISO date string | ✅ | |
| `endDate` | ISO date string | ❌ | |
| `type` | string enum | ✅ | e.g. `"CONSTRUCTION"` |
| `templateId` | UUID | ❌ | Seeds tasks from template |

### Response `200`
Full project object including the creator's `owner` membership and all seeded project roles.

---

## 2. Search Users (before sending invite)

**`GET /users/search?q=...`**
Auth: JWT + `X-Workspace-Id`
No additional permission required.

Finds users whose profile is publicly discoverable:
- `user.isPublicProfile = true`, OR
- their workspace has `allowPublicProfiles = true`

### Query params
| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `q` | string (min 2, max 100) | ✅ | Searches first+last name, username, email, workspace name/slug |
| `excludeProjectId` | UUID | ❌ | Omits users already active members of this project |
| `excludeWorkspaceId` | UUID | ❌ | Omits users already active members of this workspace |
| `page` | number | ❌ | Default `1` |
| `limit` | number (max 50) | ❌ | Default `20` |

### Response `200`
```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "firstName": "Jane",
        "lastName": "Doe",
        "userName": "janedoe",
        "email": "jane@example.com",
        "title": "Senior Engineer",
        "workspace": {
          "id": "uuid",
          "name": "BuildCorp",
          "slug": "buildcorp"
        }
      }
    ],
    "count": 42,
    "page": 1,
    "pages": 3,
    "limit": 20,
    "previousPage": null,
    "nextPage": 2
  },
  "message": "Users fetched successfully"
}
```

---

## 3. Project Invites

Project invites are for adding someone to one project. The inviter selects a `ProjectRole`; on acceptance, the backend creates/reactivates `ProjectMembership` and ensures workspace `Guest` membership if the user was not already in that workspace.

Project invite management is gated by `projectMemberManagement` on the caller's project role. During backend rollout, roles with legacy `canManageProject: true` are still accepted as a compatibility fallback.

### 3a. Send Invite

**`POST /project-invites`**
Auth: JWT
Permission: `projectMemberManagement.create` on the caller's **project** role

Invitee must already have an account — find them first via `GET /users/search`.

#### Request body
```json
{
  "projectId": "uuid",
  "inviteeUserId": "uuid",
  "projectRoleId": "uuid",
  "message": "Looking forward to working with you!"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `projectId` | UUID | ✅ | |
| `inviteeUserId` | UUID | ✅ | Must be an existing user account |
| `projectRoleId` | UUID | ✅ | Must belong to the project |
| `message` | string | ❌ | Optional personal note |

#### Response `201`
```json
{
  "data": {
    "id": "uuid",
    "projectId": "uuid",
    "projectRole": { "id": "uuid", "name": "Contributor", "slug": "contributor" },
    "inviter": { "id": "uuid", "firstName": "John", "lastName": "Smith", "email": "john@example.com", "title": "PM" },
    "invitee": { "id": "uuid", "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com", "title": "Engineer" },
    "inviteeUserId": "uuid",
    "status": "PENDING",
    "token": "...",
    "expiresAt": "2026-04-22T00:00:00.000Z",
    "acceptedAt": null,
    "message": "Looking forward to working with you!",
    "createdAt": "2026-04-15T10:00:00.000Z"
  },
  "message": "Invite sent successfully"
}
```

#### Error cases
| Status | Reason |
|--------|--------|
| 404 | `inviteeUserId` does not match any user account |
| 404 | Project not found |
| 400 | `projectRoleId` does not belong to this project or role is inactive |
| 409 | Invitee is already an active project member |
| 409 | A PENDING invite already exists for this user in this project |
| 403 | Caller is not an active project member |

---

### 3b. List Invites for a Project

**`GET /projects/:projectId/invites`**
Auth: JWT
Permission: `projectMemberManagement.view` on the caller's project role

#### Query params
| Param | Type | Notes |
|-------|------|-------|
| `status` | `PENDING` \| `ACCEPTED` \| `REVOKED` \| `EXPIRED` | Filter by status |
| `page` | number | Default `1` |
| `limit` | number | Default `20` |

#### Response `200`
```json
{
  "data": {
    "items": [ /* array of invite objects (same shape as 3a response) */ ],
    "count": 5
  },
  "message": "Invites fetched successfully"
}
```

---

### 3c. Resend Invite

**`POST /project-invites/:inviteId/resend`**
Auth: JWT
Permission: `projectMemberManagement.update` on caller's project role

Generates a new token and extends expiry by 7 days. Only works on `PENDING` invites.

#### Response `200` — same invite shape as 3a

---

### 3d. Cancel Invite

**`POST /project-invites/:inviteId/cancel`**
Auth: JWT
Permission: `projectMemberManagement.delete` on caller's project role

Sets status to `REVOKED`. Only works on `PENDING` invites.

#### Response `200`
```json
{ "data": { "id": "uuid", "canceled": true }, "message": "Invite canceled" }
```

---

### 3e. Accept Invite (by token)

**`POST /project-invites/accept?token=<token>`**
Auth: **None required** — token is the credential

The token arrives via out-of-band delivery (email, link, etc.). The frontend should:
1. Receive the token from the URL/deep-link.
2. Ensure the user is logged in (redirect to login/register if not).
3. `POST /project-invites/accept?token=<token>` — no body needed.
4. Use `projectId` from the response to redirect the user into the project.

#### Response `200`
```json
{
  "data": {
    "projectId": "uuid",
    "inviteId": "uuid",
    "message": "Looking forward to working with you!",
    "membership": {
      "id": "uuid",
      "status": "ACTIVE",
      "projectRoleId": "uuid",
      "projectRole": {
        "id": "uuid",
        "name": "Contributor",
        "slug": "contributor",
        "status": true,
        "isSystem": true,
        "isProtected": false,
        "permissions": { "taskManagement": { "create": true, "update": true, "view": true, "delete": false } }
      }
    }
  },
  "message": "Invite accepted"
}
```

#### Error cases
| Status | Reason |
|--------|--------|
| 400 | Token not found, already used, or expired |
| 404 | Invitee account no longer exists |

## 4. Workspace Invites

Workspace invites are for adding someone to the workspace without adding them to a project. The inviter selects a `WorkspaceRole`; on acceptance, the backend creates/reactivates only `WorkspaceMember`.

### 4a. Send Workspace Invite

**`POST /workspace-invites`**
Auth: JWT + `X-Workspace-Id`
Permission: `userManagement.create` on the caller's workspace role

Use `GET /users/search?q=...&excludeWorkspaceId=<workspaceId>` before sending the invite.

#### Request body
```json
{
  "workspaceId": "uuid",
  "inviteeUserId": "uuid",
  "workspaceRoleId": "uuid",
  "message": "Welcome to the workspace!"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `workspaceId` | UUID | ✅ | Should match the active workspace context |
| `inviteeUserId` | UUID | ✅ | Must be an existing user account |
| `workspaceRoleId` | UUID | ✅ | Must belong to the workspace |
| `message` | string | ❌ | Optional personal note |

#### Response `201`
```json
{
  "data": {
    "id": "uuid",
    "workspace": { "id": "uuid", "name": "BuildCorp", "slug": "buildcorp" },
    "inviter": { "id": "uuid", "firstName": "John", "lastName": "Smith", "email": "john@example.com", "title": "PM" },
    "invitee": { "id": "uuid", "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com", "title": "Engineer" },
    "role": { "id": "uuid", "name": "Member", "slug": "member", "permissions": {} },
    "status": "PENDING",
    "expiresAt": "2026-04-22T00:00:00.000Z",
    "acceptedAt": null,
    "message": "Welcome to the workspace!",
    "createdAt": "2026-04-15T10:00:00.000Z",
    "updatedAt": "2026-04-15T10:00:00.000Z"
  },
  "message": "Workspace invite sent successfully"
}
```

#### Error cases
| Status | Reason |
|--------|--------|
| 404 | `inviteeUserId` does not match any user account |
| 404 | Workspace not found |
| 400 | `workspaceRoleId` does not belong to this workspace or role is inactive |
| 409 | Invitee is already an active workspace member |
| 409 | A PENDING invite already exists for this user in this workspace |
| 403 | Caller lacks `userManagement.create` |

### 4b. List Invites for a Workspace

**`GET /workspaces/:workspaceId/invites`**
Auth: JWT + `X-Workspace-Id`
Permission: `userManagement.create` on the caller's workspace role

#### Query params
| Param | Type | Notes |
|-------|------|-------|
| `status` | `PENDING` \| `ACCEPTED` \| `DECLINED` \| `REVOKED` \| `EXPIRED` | Filter by status |
| `page` | number | Default `1` |
| `limit` | number | Default `50` |

#### Response `200`
```json
{
  "data": {
    "items": [ /* array of workspace invite objects */ ],
    "count": 5
  },
  "message": "Workspace invites fetched successfully"
}
```

### 4c. Received Workspace Invites

**`GET /workspace-invites/received`**
Auth: JWT

Returns workspace invites where the authenticated user is the invitee.

For the workspace invite inbox/action list, call:

```http
GET /workspace-invites/received?status=PENDING
```

#### Query params
| Param | Type | Notes |
|-------|------|-------|
| `status` | invite status | Optional, use `PENDING` for actionable invites |
| `page` | number | Default `1` |
| `limit` | number | Default `50` |

### 4d. Resend / Cancel Workspace Invite

```http
POST /workspace-invites/:inviteId/resend
POST /workspace-invites/:inviteId/cancel
```

Auth: JWT + `X-Workspace-Id`
Permission: `userManagement.create`

Both actions only work on `PENDING` invites. Resend generates a fresh token and extends expiry by 7 days. Cancel sets status to `REVOKED`.

### 4e. Accept Workspace Invite

```http
POST /workspace-invites/:inviteId/accept
POST /workspace-invites/accept?token=<token>
```

Authenticated accept requires the current user to be the invitee. Token-based accept uses the one-time token.

After a successful accept, refresh:

```http
GET /workspaces/me
```

Then switch the active workspace to `data.workspaceId` from the accept response if the user should land in the accepted workspace immediately.

#### Response `200`
```json
{
  "data": {
    "workspaceId": "uuid",
    "inviteId": "uuid",
    "message": "Welcome to the workspace!",
    "membership": {
      "id": "uuid",
      "status": "ACTIVE",
      "workspaceRoleId": "uuid",
      "workspaceRole": {
        "id": "uuid",
        "name": "Member",
        "slug": "member",
        "status": true,
        "isSystem": false,
        "permissions": { "projectManagement": { "create": false, "update": false, "view": true, "delete": false } }
      }
    }
  },
  "message": "Workspace invite accepted"
}
```

### 4f. Decline Workspace Invite

**`POST /workspace-invites/:inviteId/decline`**
Auth: JWT

The current user must be the invitee. Sets status to `DECLINED`.

#### Response `200`
```json
{ "data": { "id": "uuid", "declined": true }, "message": "Workspace invite declined" }
```

---

## 5. My Profile (self-service)

### 5a. Get own profile

**`GET /users/me`**
Auth: JWT + `X-Workspace-Id`

Returns the authenticated user's own record, including `isPublicProfile`.

#### Response `200`
```json
{
  "data": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Smith",
    "userName": "johnsmith",
    "email": "john@example.com",
    "title": "Project Manager",
    "status": true,
    "isDefaultPassword": false,
    "twoFactorAuthentication": false,
    "emailVerified": true,
    "isPublicProfile": false,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "message": "Profile fetched successfully"
}
```

---

### 5b. Update own profile / toggle discoverability

**`PATCH /users/me/profile`**
Auth: JWT + `X-Workspace-Id`

Users can update their own display fields and toggle whether they appear in `GET /users/search`.

#### Request body (all fields optional)
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "userName": "johnsmith",
  "title": "Senior PM",
  "isPublicProfile": true
}
```

| Field | Type | Notes |
|-------|------|-------|
| `firstName` | string (max 100) | |
| `lastName` | string (max 100) | |
| `userName` | string (max 100) | |
| `title` | string (max 200) | |
| `isPublicProfile` | boolean | `true` → user appears in search results globally |

#### Response `200` — same shape as `GET /users/me`

> **Note:** Admin-controlled fields (email, status, workspace role) are not editable here. Use `PATCH /users/:id` (requires `userManagement.update` permission).

---

## 6. Workspace Settings (admin only)

**`PATCH /workspaces/:workspaceId/settings`**
Auth: JWT only (no `X-Workspace-Id` header needed)
Permission: caller must have `userManagement.update` on their **workspace role** for this workspace (checked server-side).

Controls workspace-level discoverability: when `allowPublicProfiles` is `true`, all active members of the workspace become searchable via `GET /users/search` — regardless of each member's individual `isPublicProfile` flag.

#### Request body (all fields optional)
```json
{
  "name": "BuildCorp",
  "description": "Construction workflows for BuildCorp",
  "allowPublicProfiles": true
}
```

| Field | Type | Notes |
|-------|------|-------|
| `name` | string (2–200 chars) | |
| `description` | string (max 1000) | |
| `allowPublicProfiles` | boolean | `true` → entire workspace is discoverable |

#### Response `200`
```json
{
  "data": {
    "id": "uuid",
    "name": "BuildCorp",
    "slug": "buildcorp",
    "description": "Construction workflows for BuildCorp",
    "allowPublicProfiles": true,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "message": "Workspace settings updated"
}
```

#### Error cases
| Status | Reason |
|--------|--------|
| 403 | Caller's workspace role lacks `userManagement.update` |
| 404 | Workspace not found or caller is not a member |

---

## Discoverability logic (summary)

A user appears in `GET /users/search` results when:
- `user.isPublicProfile = true` (individual opt-in), **OR**
- `workspace.allowPublicProfiles = true` for any workspace the user is an active member of

Both flags default to `false` (opt-in model). Use `excludeProjectId` to pre-filter users already in the target project, and `excludeWorkspaceId` to pre-filter users already in the target workspace.

---

## Typical project invite flow (end-to-end)

```
1. User opens "Invite member" dialog in a project
2. Frontend: GET /users/search?q=jane&excludeProjectId=<projectId>
3. User picks Jane from results (gets her UUID)
4. User selects a project role from the role picker (gets projectRoleId)
5. Frontend: POST /project-invites { projectId, inviteeUserId, projectRoleId, message? }
6. Backend creates PENDING invite, generates token, sends email (your email service picks it up)
7. Jane clicks the link → token in URL → frontend reads it
8. If Jane not logged in → redirect to login/register, then resume
9. Frontend: POST /project-invites/accept?token=<token>
10. Backend: creates membership, returns { projectId, membership }
11. Frontend: redirect Jane into the project with projectId
```

## Typical workspace invite flow (end-to-end)

```
1. User opens "Invite to workspace" dialog in workspace/team settings
2. Frontend: GET /users/search?q=jane&excludeWorkspaceId=<workspaceId>
3. User picks Jane from results (gets her UUID)
4. User selects a workspace role from the role picker (gets workspaceRoleId)
5. Frontend: POST /workspace-invites { workspaceId, inviteeUserId, workspaceRoleId, message? }
6. Backend creates PENDING invite, generates token, and sends WORKSPACE_INVITE_RECEIVED notification
7. Jane opens the invite from notification or link
8. Frontend: POST /workspace-invites/:inviteId/accept or POST /workspace-invites/accept?token=<token>
9. Backend: creates/reactivates workspace membership, assigns workspace role, returns { workspaceId, membership }
10. Frontend: refresh workspace list/membership context and switch to workspaceId if desired
```

## Invite notification types

Project invite notifications:

```ts
PROJECT_INVITE_RECEIVED
PROJECT_INVITE_ACCEPTED
PROJECT_INVITE_DECLINED
PROJECT_INVITE_REVOKED
```

Workspace invite notifications:

```ts
WORKSPACE_INVITE_RECEIVED
WORKSPACE_INVITE_ACCEPTED
WORKSPACE_INVITE_DECLINED
WORKSPACE_INVITE_REVOKED
```

The notification `meta` includes `inviteType: 'project' | 'workspace'` plus the relevant `inviteId`, target id, and role id/name.

---

# Task Documents Frontend Contract

Base route:

```http
/projects/:projectId/tasks/:taskId/documents
```

Auth: JWT + `X-Workspace-Id`

Permissions:

| Operation | Project permission |
|-----------|--------------------|
| List, read, download/open file | `taskManagement.view` |
| Create, update, delete, create starter from deliverable | `taskManagement.update` |

## Domain Types

```ts
export type TaskDocumentType = 'STARTER' | 'DELIVERABLE';

export type TaskDocumentUserRelation = {
  id: string;
  firstName: string;
  lastName: string;
  userName: string | null;
  email: string;
  title: string | null;
};

export type TaskDocumentTaskRelation = {
  id: string;
  title: string;
  wbsCode: string | null;
  scheduleType: string | null;
};

export type TaskDocumentSourceDocumentRelation = {
  id: string;
  name: string;
  description: string | null;
  type: TaskDocumentType;
  createdAt: string;
  updatedAt: string;
};

export type TaskDocumentSourceAttachmentRelation = {
  id: string;
  filename: string;
  bucketName: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
};

export type TaskDocumentAttachment = {
  id: string;
  documentId: string | null;
  sourceAttachmentId: string | null;
  sourceAttachment: TaskDocumentSourceAttachmentRelation | null;
  filename: string;
  bucketName: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  createdById: string | null;
  createdBy: TaskDocumentUserRelation | null;
  downloadUrl: string | null;
};

export type TaskDocument = {
  id: string;
  taskId: string | null;
  sourceTaskId: string | null;
  sourceDocumentId: string | null;
  task: TaskDocumentTaskRelation | null;
  sourceTask: TaskDocumentTaskRelation | null;
  sourceDocument: TaskDocumentSourceDocumentRelation | null;
  createdById: string | null;
  createdBy: TaskDocumentUserRelation | null;
  createdAt: string;
  updatedById: string | null;
  updatedBy: TaskDocumentUserRelation | null;
  updatedAt: string;
  name: string;
  description: string | null;
  type: TaskDocumentType;
  attachments: TaskDocumentAttachment[];
};
```

Traceability relation fields are nullable. `sourceTask`, `sourceDocument`, and `attachment.sourceAttachment` are populated when a target `STARTER` document is created from another task's `DELIVERABLE`. The scalar `*Id` fields remain available for route calls and backwards-compatible frontend state keys, but the UI should prefer relation objects for display.

## List Task Documents

```http
GET /projects/:projectId/tasks/:taskId/documents
```

Query params:

| Param | Type | Notes |
|-------|------|-------|
| `type` | `STARTER \| DELIVERABLE` | Optional tab filter |
| `name` | string | Optional document-name search |
| `page` | number | Optional pagination |
| `limit` | number | Optional pagination |

Response `200`:

```ts
{
  data: {
    items: TaskDocument[];
    count: number;
    pages: number;
    previousPage: number | null;
    page: number;
    nextPage: number | null;
    limit: number;
  };
  message: 'Task documents fetched';
}
```

Recommended frontend usage:

```ts
fetchTaskDocuments({
  projectId,
  taskId,
  query: { type: 'STARTER', page: 1, limit: 50 }
});
```

## Get One Task Document

```http
GET /projects/:projectId/tasks/:taskId/documents/:documentId
```

Response `200`:

```ts
{
  data: TaskDocument;
  message: 'Task document fetched';
}
```

## Create Task Document By Upload

```http
POST /projects/:projectId/tasks/:taskId/documents
Content-Type: multipart/form-data
```

Form fields:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `name` | Yes | string | 1-255 chars |
| `type` | Yes | `STARTER \| DELIVERABLE` | Enum only |
| `file` | Yes | binary | File is required on create |
| `description` | No | string \| null | 1-4000 chars when present |
| `bucketName` | No | string | Defaults to backend task-documents bucket |
| `attachmentNotes` | No | string \| null | Notes for the uploaded active attachment |

Response `201`:

```ts
{
  data: TaskDocument;
  message: 'Task document created';
}
```

Behavior:

- The uploaded file becomes the only active attachment for the new document.
- `createdAt`, `createdBy`, `updatedAt`, and `updatedBy` are returned on the document.
- Attachment history fields `createdAt` and `createdBy` are returned on the attachment.

## Update Task Document

```http
PATCH /projects/:projectId/tasks/:taskId/documents/:documentId
Content-Type: multipart/form-data
```

Form fields are all optional:

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | 1-255 chars |
| `type` | `STARTER \| DELIVERABLE` | Enum only |
| `description` | string \| null | 1-4000 chars when present |
| `bucketName` | string | Used only when `file` is present |
| `attachmentNotes` | string \| null | Used for the new active attachment when `file` is present |
| `file` | binary | Optional on update |

Response `200`:

```ts
{
  data: TaskDocument;
  message: 'Task document updated';
}
```

Behavior:

- Metadata-only edits are allowed.
- If `file` is provided, the previous active attachment is marked inactive and the new upload becomes the only active attachment.
- The document always returns at most one active attachment.

## Delete Task Document

```http
DELETE /projects/:projectId/tasks/:taskId/documents/:documentId
```

Response `200`:

```ts
{
  data: {
    deleted: true;
    id: string;
  };
  message: 'Task document deleted';
}
```

## Download Or Open Attachment

```http
GET /projects/:projectId/tasks/:taskId/documents/:documentId/attachments/:attachmentId/download-url
```

Response `200`:

```ts
{
  data: {
    downloadUrl: string;
  };
  message: 'Task document attachment download URL fetched';
}
```

Notes:

- `TaskDocumentAttachment.downloadUrl` is also included in list/get responses when the backend can generate it.
- Frontend can use `window.open(downloadUrl, '_blank')` for open/preview behavior, or an anchor download flow for file download.
- If a `downloadUrl` is missing or expired, call this endpoint for a fresh URL.

## Create Starter From Deliverable

```http
POST /projects/:projectId/tasks/:targetTaskId/documents/from-deliverable
Content-Type: application/json
```

Request body:

```ts
{
  sourceTaskId: string;
  sourceDocumentId: string;
  name?: string;
  description?: string | null;
  attachmentNotes?: string | null;
}
```

Response `201`:

```ts
{
  data: TaskDocument;
  message: 'Starter document created from deliverable';
}
```

Response behavior:

- `data.type` is always `STARTER`.
- `data.task` is the target task relation.
- `data.sourceTask` is the source task relation.
- `data.sourceDocument` is the deliverable document relation.
- The returned active attachment has `sourceAttachment` set to the source deliverable's active attachment relation.
- The returned active attachment reuses the source attachment `filename` and `bucketName`.
- No file upload is required for this endpoint.

Backend validation:

| Rule | Frontend handling |
|------|-------------------|
| Target task must belong to `projectId` | Use the currently focused task route context |
| Source task must belong to same `projectId` | Only show source tasks from the same project board |
| Source task cannot be the target task | Exclude the focused task from the picker |
| Source document must belong to `sourceTaskId` | Fetch deliverables through the selected source task |
| Source document must have `type = DELIVERABLE` | Query with `type=DELIVERABLE` |
| Source document must have exactly one active attachment | Disable source rows without an active attachment |

Recommended frontend helper:

```ts
export function createStarterFromDeliverable(
  projectId: string,
  targetTaskId: string,
  payload: {
    sourceTaskId: string;
    sourceDocumentId: string;
    name?: string;
    description?: string | null;
    attachmentNotes?: string | null;
  },
) {
  return api.post(
    `/projects/${projectId}/tasks/${targetTaskId}/documents/from-deliverable`,
    payload,
  );
}
```

Recommended UI flow:

1. On starter tab, offer `Upload starter file` and `Select deliverable from another task`.
2. For selection, list other tasks in the same project and exclude the focused task.
3. Fetch source deliverables with:

```ts
fetchTaskDocuments({
  projectId,
  taskId: sourceTaskId,
  query: { type: 'DELIVERABLE', page: 1, limit: 50 }
});
```

4. Show each deliverable with `name`, `description`, `updatedAt`, and active attachment filename.
5. Submit `createStarterFromDeliverable`.
6. After success, refetch the target task's `STARTER` list so sorting, traceability, and active attachment state come from the backend.

## Frontend Cache And Sorting Notes

- Sort document rows by `updatedAt` descending unless the screen has a stronger product-specific order.
- Use `createdAt`/`createdBy` on attachments as file history metadata.
- Prefer relation objects (`createdBy`, `updatedBy`, `sourceTask`, `sourceDocument`, `sourceAttachment`) for display instead of resolving names from raw ids.
- Treat `attachments.find((attachment) => attachment.isActive)` as the current file.
- Never assume more than one active attachment per document.
- After create, update, delete, or create-from-deliverable, refetch the affected task/type list instead of mutating nested attachment state by hand.
