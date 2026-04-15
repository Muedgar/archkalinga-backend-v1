# ArchKalinga Frontend Migration Guide
**Backend refactor: Organization → Workspace model**
_Prepared for the frontend agent — covers every breaking change in API contracts, request shapes, response shapes, and header requirements._

---

## 1. New Required Header (Breaking — affects all workspace-scoped requests)

Every request that touches workspace resources **must** include:

```
X-Workspace-Id: <uuid>
```

This header replaced the old pattern where the user's `organizationId` was embedded in the JWT. The backend validates active membership for the given workspace on every request that uses workspace-scoped endpoints (everything except auth).

**What to do:**
- After login/signup, store the `workspaceId` returned in the auth response.
- Attach `X-Workspace-Id: <workspaceId>` to every API request (add it to your Axios/Fetch interceptor or equivalent).
- If the header is missing → `401`. If the user is not an active member → `403`.

---

## 2. Auth — Signup

### Request body changes

| Old field | New field | Notes |
|---|---|---|
| `userType` | _(removed)_ | |
| `organizationName` | `workspaceName` | Required, max 200 chars |
| `organizationDescription` | `workspaceDescription` | Optional, max 500 chars |
| `organizationAddress` | _(removed)_ | |
| `organizationCity` | _(removed)_ | |
| `organizationCountry` | _(removed)_ | |
| `organizationWebsite` | _(removed)_ | |
| `profession` | _(removed)_ | |
| `specialty` | _(removed)_ | |

**New signup request shape:**
```json
{
  "firstName": "string",
  "lastName": "string",
  "userName": "string",
  "email": "string",
  "password": "string",
  "title": "string (optional)",
  "workspaceName": "string (required)",
  "workspaceDescription": "string (optional)"
}
```

### Response body changes

The auth response now includes workspace and membership context alongside tokens:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": { ...UserSerializer fields... },
  "workspaceId": "uuid",
  "workspaceName": "string",
  "workspaceMemberId": "uuid"
}
```

**Store `workspaceId` from this response** — it is needed for the `X-Workspace-Id` header on all subsequent requests.

---

## 3. User Object — Removed Fields

The `user` object returned from auth (login, signup, /me) no longer contains organization or role data. Those are now accessed separately through workspace membership.

**Fields removed from user object:**

| Removed field | Where to find it now |
|---|---|
| `userType` | _(gone entirely)_ |
| `roleId` | `workspaceMember.workspaceRoleId` |
| `organization.id` | `workspaceId` from auth response |
| `organization.name` | Workspace endpoint |
| `organization.slug` | Workspace endpoint |
| `role.name` | `workspaceMember.workspaceRole.name` |
| `role.slug` | `workspaceMember.workspaceRole.slug` |
| `role.permissions` | `workspaceMember.workspaceRole.permissions` |

**New user object shape:**
```json
{
  "id": "uuid",
  "firstName": "string",
  "lastName": "string",
  "userName": "string",
  "email": "string",
  "title": "string | null",
  "status": "ACTIVE | INACTIVE | ...",
  "isDefaultPassword": "boolean",
  "twoFactorAuthentication": "boolean",
  "emailVerified": "boolean",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

---

## 4. New: Workspace Member Object

Wherever the backend previously attached role info to the user, it now returns a `workspaceMember` object. This is returned from membership-related endpoints.

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "userId": "uuid",
  "workspaceRoleId": "uuid",
  "status": "ACTIVE | REMOVED",
  "joinedAt": "ISO timestamp",
  "createdAt": "ISO timestamp",
  "workspaceRole": {
    "id": "uuid",
    "name": "string",
    "slug": "string",
    "status": "ACTIVE | INACTIVE",
    "isSystem": "boolean",
    "permissions": {
      "userManagement":          { "create": true, "update": true, "view": true, "delete": true },
      "roleManagement":          { "create": true, "update": true, "view": true, "delete": true },
      "templateManagement":      { "create": true, "update": true, "view": true, "delete": true },
      "projectManagement":       { "create": true, "update": true, "view": true, "delete": true },
      "taskManagement":          { "create": true, "update": true, "view": true, "delete": true },
      "documentManagement":      { "create": true, "update": true, "view": true, "delete": true },
      "changeRequestManagement": { "create": true, "update": true, "view": true, "delete": true }
    }
  }
}
```

**For role-based UI (show/hide buttons, disable inputs):** read `workspaceMember.workspaceRole.permissions[domain][action]` — e.g. `permissions.projectManagement.create`.

---

## 5. New: Workspace Object

```json
{
  "id": "uuid",
  "name": "string",
  "slug": "string",
  "description": "string | null",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

---

## 6. Roles — Renamed Fields

The `WorkspaceRole` (formerly `Role`) shape now uses `workspaceId` instead of `organizationId`:

| Old field | New field |
|---|---|
| `organizationId` | `workspaceId` |

**New role object shape:**
```json
{
  "id": "uuid",
  "name": "string",
  "slug": "string",
  "status": "ACTIVE | INACTIVE",
  "workspaceId": "uuid",
  "isSystem": "boolean",
  "permissions": { ...permission matrix... },
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

Note: `isSystem: true` roles (e.g. Admin) cannot be deleted. The UI should hide the delete button for these.

---

## 7. Projects — Renamed Fields

| Old field | New field |
|---|---|
| `organizationId` | `workspaceId` |

This applies to both the full project object and the project list item shape.

---

## 8. Templates — Renamed Fields

| Old field | New field |
|---|---|
| `organizationId` | `workspaceId` |

---

## 9. Audit Logs — Renamed Fields

| Old field | New field |
|---|---|
| `organizationId` | `workspaceId` |

---

## 10. Permission Domains Reference

The backend enforces permissions using this matrix. Each domain has four actions: `create`, `update`, `view`, `delete`.

| Domain | Description |
|---|---|
| `userManagement` | Manage workspace collaborators |
| `roleManagement` | Manage workspace roles |
| `templateManagement` | Manage project templates |
| `projectManagement` | Create and manage projects |
| `taskManagement` | Create and manage tasks |
| `documentManagement` | Upload and manage project documents |
| `changeRequestManagement` | Create and review change requests |

Use `workspaceMember.workspaceRole.permissions[domain][action]` to gate UI elements.

---

## 11. Multi-Workspace Support

The new architecture supports a single user belonging to multiple workspaces. The frontend should handle:

- Storing multiple workspaces a user belongs to (fetched from a membership list endpoint)
- A workspace switcher UI — on switch, update the stored `workspaceId` and the `X-Workspace-Id` header sent with all requests
- On login, the auth response provides the initial `workspaceId` (the workspace created at signup or the first active membership)

---

## 12. Summary Checklist for Frontend

- [ ] Add `X-Workspace-Id` header to all HTTP requests (interceptor level)
- [ ] Update signup form: remove org address/country/website/profession/specialty; add `workspaceName` and optional `workspaceDescription`
- [ ] Store `workspaceId`, `workspaceMemberId` from auth response
- [ ] Remove user fields: `userType`, `roleId`, `organization`, `role`
- [ ] Load role/permissions from `workspaceMember.workspaceRole.permissions`
- [ ] Update any display of `organizationId` → `workspaceId` in project, template, audit log, and role objects
- [ ] Hide delete button on roles where `isSystem === true`
- [ ] Build workspace switcher if multi-workspace UX is planned
- [ ] Update any references to `role.organizationId` → `role.workspaceId`
