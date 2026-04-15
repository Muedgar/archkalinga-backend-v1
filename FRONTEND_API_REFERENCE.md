# ArchKalinga API Reference — Project Create, Invite & Discovery Flow

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

### 3a. Send Invite

**`POST /project-invites`**
Auth: JWT + `X-Workspace-Id`
Permission: `projectManagement.update` on the caller's **project** role

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
Auth: JWT + `X-Workspace-Id`
Permission: `projectManagement.view` on the caller's project role

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
Auth: JWT + `X-Workspace-Id`
Permission: `projectManagement.update` on caller's project role

Generates a new token and extends expiry by 7 days. Only works on `PENDING` invites.

#### Response `200` — same invite shape as 3a

---

### 3d. Cancel Invite

**`POST /project-invites/:inviteId/cancel`**
Auth: JWT + `X-Workspace-Id`
Permission: `projectManagement.update` on caller's project role

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

---

## 4. My Profile (self-service)

### 4a. Get own profile

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

### 4b. Update own profile / toggle discoverability

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

## 5. Workspace Settings (admin only)

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

Both flags default to `false` (opt-in model). Use `excludeProjectId` on the search endpoint to pre-filter users who are already in the target project.

---

## Typical invite flow (end-to-end)

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
