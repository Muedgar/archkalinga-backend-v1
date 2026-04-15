# Backend Handoff: Auth and User Management

## Goal

This frontend already has working mock flows for:

- sign up
- sign in
- forgot password
- protected session access
- roles and permissions
- collaborator (user) listing
- collaborator detail view
- collaborator create/update
- admin password reset for another user
- project invite acceptance after login/signup

Backend work should replace the mock Redux thunks and localStorage-backed stores with real APIs.

## Access model update

The requirements now use a two-layer access model:

- workspace roles and permissions are user-scoped
- project roles and permissions are membership-scoped
- project invites assign project roles upon acceptance

This means:

- a user keeps one workspace role for organization-level capabilities
- a project membership carries the user's project role for that specific project
- invites must specify which project role the invitee should receive
- accepting an invite grants project-scoped authority, not workspace-scoped authority

## Important product rule

For now, every newly created account should start with the `Admin` workspace role.

That rule is already reflected in the frontend mock signup flow:

- signup creates a workspace/organization
- an admin role is ensured for that workspace
- the signed-up user is assigned that admin role

Related frontend references:

- `modules/auth/store/thunks/signup.slice.ts`
- `modules/roles/store/mock/roles-mock-data.ts`

## Current frontend data model

### Auth user shape expected by the frontend

The signed-in user stored in auth state currently expects:

```ts
type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  title: string;
  organization: {
    id: string;
    organizationName: string;
    organizationAddress: string;
    organizationCity: string;
    organizationCountry: string;
  };
  status: boolean;
  isDefaultPassword: boolean;
  userType: string;
  twoFactorAuthentication: boolean;
  role: {
    id: string;
    name: string;
    slug: string;
    status: boolean;
    permissions: Array<{
      id: string;
      name: string;
      slug: string;
      status: boolean;
    }>;
  };
  roleId?: string;
};
```

Frontend references:

- `modules/auth/interfaces/user.interface.ts`
- `modules/auth/interfaces/organization-interface.ts`
- `modules/auth/interfaces/role-interface.ts`

### Collaborator/user management shape expected by users screens

The users module uses nearly the same shape, with a few optional fields:

```ts
type User = {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  title?: string;
  status: boolean;
  organization?: Organization;
  isDefaultPassword?: boolean;
  userType?: string;
  twoFactorAuthentication?: boolean;
  role?: Role;
  roleId?: string;
  createdBy?: User;
};
```

Frontend reference:

- `modules/users/interfaces/user.interface.ts`

### Profile data shown in the collaborator detail page

The collaborator detail drawer also expects profile-like fields:

```ts
type UserProfile = {
  id: string;
  userId: string;
  userType: 'INDIVIDUAL' | 'ORGANIZATION';
  profession?: string;
  specialty?: string;
  bio?: string;
  organizationName?: string;
  teamSize?: number | null;
  organizationWebsite?: string;
  createdAt: string;
  updatedAt: string;
};
```

Frontend references:

- `modules/users/interfaces/mock-user-profile.interface.ts`
- `modules/users/components/view/view.tsx`

## Recommended backend entities

### 1. `organizations`

Suggested fields:

- `id`
- `name`
- `address`
- `city`
- `country`
- `website` nullable
- `created_at`
- `updated_at`

Notes:

- the frontend currently uses `organizationName`, `organizationAddress`, `organizationCity`, `organizationCountry`
- backend can keep better naming internally, but API should map cleanly to the frontend response

### 2. `roles`

Suggested fields:

- `id`
- `organization_id`
- `name`
- `slug`
- `status`
- `created_at`
- `updated_at`

Interpretation:

- these are workspace roles
- they are assigned directly to users
- they govern workspace-level access such as user management, role management, and template management

### 3. `role_permissions`

Two good options:

1. normalized table:
   - `id`
   - `role_id`
   - `domain`
   - `action`
   - `allowed`
2. JSON column on `roles`

Because the frontend role screens already edit permissions as a matrix, JSON is fine if you want speed.

Recommended workspace permission domains:

- `userManagement`
- `roleManagement`
- `templateManagement`

Project permission domains should be modeled separately on project roles:

- `projectManagement`
- `changeRequestManagement`
- `taskManagement`
- `documentManagement`

Actions:

- `create`
- `update`
- `view`
- `delete`

Frontend references:

- `modules/roles/interfaces/role.interface.ts`
- `lib/permissions.ts`

Recommended interpretation:

- this permission matrix should be treated as the workspace permission matrix
- project-level access should not be modeled only through these permissions

### 4. `users`

Suggested fields:

- `id`
- `organization_id`
- `role_id`
- `first_name`
- `last_name`
- `user_name`
- `email`
- `password_hash`
- `title`
- `status`
- `user_type` enum `INDIVIDUAL | ORGANIZATION`
- `is_default_password`
- `two_factor_authentication`
- `last_login_at` nullable
- `created_by` nullable
- `created_at`
- `updated_at`

Constraints:

- unique `email`
- unique `user_name`
- unique role name per organization

Interpretation:

- `role_id` is the user's workspace role
- project-level access should be derived separately from project membership and project role

### 5. `project_roles`

Suggested fields:

- `id`
- `project_id`
- `name`
- `slug`
- `status`
- `permissions`
- `created_at`
- `updated_at`

Notes:

- project roles are scoped to a single project
- they control what a member can do inside that project
- they may reuse the same domain/action matrix shape as workspace roles, but only for project domains

### 6. `project_memberships`

Suggested fields:

- `id`
- `project_id`
- `user_id`
- `project_role_id`
- `status`
- `invited_by_user_id`
- `invite_id`
- `joined_at`
- `removed_at`
- `created_at`
- `updated_at`

### 7. `project_invites`

Suggested fields:

- `id`
- `project_id`
- `inviter_user_id`
- `invitee_email`
- `invitee_user_id` nullable
- `project_role_id`
- `token`
- `status`
- `expires_at`
- `accepted_at`
- `created_at`
- `updated_at`

Important invite rule:

- accepting a project invite should create or reactivate a membership and assign the invited project role

### 8. `user_profiles`

Suggested fields:

- `id`
- `user_id`
- `profession` nullable
- `specialty` nullable
- `bio` nullable
- `organization_name` nullable
- `organization_website` nullable
- `team_size` nullable
- `created_at`
- `updated_at`

## Auth APIs needed

### `POST /auth/signup`

Purpose:

- support both `INDIVIDUAL` and `ORGANIZATION` signup
- create organization/workspace context
- create first user
- assign `Admin` role automatically
- return authenticated session/user payload

Clarification from the frontend signup flow:

- if `userType = ORGANIZATION`, organization fields are collected explicitly
- if `userType = INDIVIDUAL`, the frontend still creates a workspace-style organization record using the user's identity
- in both cases, the first signed-up account becomes `Admin`

Frontend request shape already implied by signup schema:

```json
{
  "userType": "INDIVIDUAL",
  "userName": "jdoe",
  "firstName": "John",
  "lastName": "Doe",
  "title": "Architect",
  "email": "john@example.com",
  "password": "Secret123!",
  "profession": "Architect",
  "specialty": "Interior Design",
  "organizationName": "",
  "organizationAddress": "",
  "organizationCity": "",
  "organizationCountry": "",
  "organizationWebsite": ""
}
```

Validation already enforced in frontend:

- `userType` is `INDIVIDUAL` or `ORGANIZATION`
- base user fields are required
- password must be strong
- if `INDIVIDUAL`, require `profession` and `specialty`
- if `ORGANIZATION`, require organization fields and validate website format

Frontend reference:

- `modules/auth/schemas/signup/signup.schema.ts`

Recommended response:

```json
{
  "accessToken": "jwt",
  "refreshToken": "jwt-or-random-token",
  "user": {
    "...": "AuthUser shape"
  }
}
```

### `POST /auth/signin`

Request:

```json
{
  "email": "john@example.com",
  "password": "Secret123!"
}
```

Response:

```json
{
  "accessToken": "jwt",
  "refreshToken": "jwt-or-random-token",
  "user": {
    "...": "AuthUser shape"
  }
}
```

Frontend reference:

- `modules/auth/schemas/signin/signin.schema.ts`

### `POST /auth/forgot-password`

Request:

```json
{
  "email": "john@example.com"
}
```

Expected behavior:

- always return success-like response to avoid email enumeration
- send reset link/email out-of-band

Frontend reference:

- `modules/auth/forms/forgot-password/forgot-password.tsx`

### `POST /auth/reset-password`

Needed because frontend already has a reset-password route at:

- `app/(auth)/reset-password/page.tsx`

Recommended request:

```json
{
  "token": "reset-token",
  "newPassword": "NewSecret123!"
}
```

### `POST /auth/refresh`

Needed if using access/refresh token split.

### `POST /auth/logout`

Optional if refresh tokens are stateful or need revocation.

### `GET /auth/me`

Needed to restore frontend auth state after refresh when mock auth is removed.

Recommended response:

```json
{
  "user": {
    "...": "AuthUser shape"
  }
}
```

## User management APIs needed

### `GET /users`

Used by collaborators page.

Recommended query params:

- `page`
- `limit`
- `search`
- `sortBy`
- `sortOrder`
- optional filters such as `status`, `roleId`

Recommended response:

```json
{
  "items": [],
  "count": 0,
  "pages": 1,
  "page": 1,
  "limit": 10
}
```

Frontend references:

- `app/(dashboard)/users/page.tsx`
- `modules/users/store/thunks/user.thunk.ts`
- `modules/users/interfaces/query.interface.ts`

### `GET /users/:id`

Used by collaborator detail and update forms.

Recommended response:

```json
{
  "id": "user-id",
  "firstName": "John",
  "lastName": "Doe",
  "userName": "jdoe",
  "email": "john@example.com",
  "title": "Architect",
  "status": true,
  "userType": "INDIVIDUAL",
  "isDefaultPassword": true,
  "twoFactorAuthentication": false,
  "organization": {},
  "role": {},
  "roleId": "role-id",
  "profile": {}
}
```

Note:

- the current users module keeps profile data separately, but returning it together from backend will simplify the frontend migration

### `POST /users`

Used by admin create-collaborator flow.

Current frontend request shape:

```json
{
  "userName": "jdoe.arch",
  "firstName": "John",
  "lastName": "Doe",
  "title": "Staff",
  "email": "john@company.com",
  "status": true,
  "password": "Secret123!",
  "roleId": "role-id"
}
```

Frontend references:

- `modules/users/schemas/create/create.schema.ts`
- `modules/users/forms/create/create.form.tsx`

Recommended behavior:

- create user inside authenticated admin's organization
- enforce unique email and username
- set `isDefaultPassword = true`
- set `twoFactorAuthentication = false` by default
- accept `roleId`

### `PATCH /users/:id`

Used by admin edit collaborator flow.

Request:

```json
{
  "userName": "jdoe.arch",
  "firstName": "John",
  "lastName": "Doe",
  "title": "Staff",
  "email": "john@company.com",
  "status": true,
  "roleId": "role-id"
}
```

Frontend references:

- `modules/users/schemas/update/update.schema.ts`
- `modules/users/forms/update/update.form.tsx`

### `PATCH /users/:id/password`

Used by admin to change another user password.

Request:

```json
{
  "newPassword": "NewSecret123!"
}
```

Recommended behavior:

- admin-only
- set `isDefaultPassword = false` unless product wants forced-change-on-next-login
- consider optionally adding `mustChangePasswordOnNextLogin`

Frontend reference:

- `modules/users/forms/change-password/change-password.form.tsx`

### Optional self-service endpoint: `PATCH /users/me/password`

Recommended for normal authenticated password change.

## Roles APIs needed

Because users depend on roles for role selection and permission checks, backend should also provide:

- `GET /roles`
- `GET /roles/:id`
- `POST /roles`
- `PATCH /roles/:id`

Recommended role payload:

```json
{
  "id": "role-id",
  "name": "Admin",
  "status": true,
  "permissions": {
    "projectManagement": {
      "create": true,
      "update": true,
      "view": true,
      "delete": true
    },
    "changeRequestManagement": {
      "create": true,
      "update": true,
      "view": true,
      "delete": true
    },
    "taskManagement": {
      "create": true,
      "update": true,
      "view": true,
      "delete": true
    },
    "documentManagement": {
      "create": true,
      "update": true,
      "view": true,
      "delete": true
    },
    "userManagement": {
      "create": true,
      "update": true,
      "view": true,
      "delete": true
    },
    "roleManagement": {
      "create": true,
      "update": true,
      "view": true,
      "delete": true
    },
    "templateManagement": {
      "create": true,
      "update": true,
      "view": true,
      "delete": true
    }
  },
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

Important:

- on signup, if no admin role exists for the new organization, backend should create it automatically
- for now every new top-level account gets this admin role

## Invite-related auth consideration

The frontend supports this flow:

1. user opens project invite link
2. if not authenticated, frontend redirects to login with `inviteToken`
3. after login or signup, frontend continues invite acceptance

Relevant frontend references:

- `app/invite/[token]/page.tsx`
- `modules/auth/forms/login/signin.tsx`
- `modules/auth/forms/signup/signup.tsx`

Backend implication:

- auth endpoints do not need special invite logic
- but project invite acceptance endpoint should work immediately after signup/signin
- authenticated user identity should be available right away

## Recommended response normalization

To reduce frontend changes, backend responses should consistently include:

- `roleId`
- nested `role`
- nested `organization`

Example normalized user response:

```json
{
  "id": "user_123",
  "firstName": "John",
  "lastName": "Doe",
  "userName": "jdoe",
  "email": "john@example.com",
  "title": "Architect",
  "status": true,
  "isDefaultPassword": true,
  "userType": "INDIVIDUAL",
  "twoFactorAuthentication": false,
  "roleId": "role_admin",
  "role": {
    "id": "role_admin",
    "name": "Admin",
    "slug": "admin",
    "status": true,
    "permissions": []
  },
  "organization": {
    "id": "org_123",
    "organizationName": "Acme Studio",
    "organizationAddress": "Kigali Heights",
    "organizationCity": "Kigali",
    "organizationCountry": "Rwanda"
  }
}
```

## Backend priorities

Suggested delivery order:

1. `POST /auth/signup`
2. `POST /auth/signin`
3. `GET /auth/me`
4. `GET /roles`
5. `GET /users`
6. `GET /users/:id`
7. `POST /users`
8. `PATCH /users/:id`
9. `PATCH /users/:id/password`
10. forgot/reset password endpoints

## Notes for the backend agent

- The frontend already treats organization as tenant/workspace.
- Signup currently creates a brand new organization/workspace.
- User creation from the collaborators screen creates users inside the current authenticated user's organization.
- Permissions are checked in the frontend using the role permission matrix.
- If backend returns permissions in a different structure, the frontend permission code will need adaptation.
- Right now the frontend assumes role selection is available when creating/updating users, even though all newly signed-up accounts start as admin.

## Files most relevant for backend integration

- `modules/auth/schemas/signup/signup.schema.ts`
- `modules/auth/schemas/signin/signin.schema.ts`
- `modules/auth/store/thunks/signup.slice.ts`
- `modules/auth/store/thunks/signin.slice.ts`
- `modules/auth/store/mock/auth-db.ts`
- `modules/users/store/thunks/user.thunk.ts`
- `modules/users/forms/create/create.form.tsx`
- `modules/users/forms/update/update.form.tsx`
- `modules/users/forms/change-password/change-password.form.tsx`
- `modules/users/components/view/view.tsx`
- `modules/roles/store/thunks/roles.thunks.ts`
- `modules/roles/interfaces/role.interface.ts`
- `lib/permissions.ts`
