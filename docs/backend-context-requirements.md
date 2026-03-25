# Backend Context and Requirements

## Purpose

This document explains the current frontend product so a backend agent can design the right services, entities, and API contracts.

The codebase is not a simple UI mockup. It already models:

- authentication and workspace onboarding
- tenants/organizations
- users and roles
- templates
- projects
- project membership and invites
- task management across kanban, mind map, and gantt views
- document workflows with versions, approvals, change requests, and distribution logs
- contribution history and permission-aware UI

The backend should treat the frontend as a domain prototype with real product intent, not as placeholder screens.

## Historical Product Intent

The original requirements were broader than the current frontend surface. Over time, scope shifted, but that history is still useful because it explains the intended operational direction of the platform.

Originally, ArchKalinga was framed around five major operational domains:

- project management
- document management
- procurement management
- task management
- change management

There was also a simplified consultation access concept for external consultants.

This history matters because:

- the current frontend already strongly reflects project, task, and document workflows
- the permission model and tenant model are compatible with future procurement and change modules
- backend decisions made now should avoid blocking those future domains

The backend agent should therefore separate:

- `current implemented frontend scope`
- `historical and likely future business scope`

The current frontend scope should drive immediate API work, while the historical scope should inform domain modeling and naming choices.

## Product Summary

ArchKalinga is a tenant-aware project and construction workflow platform.

The frontend currently supports these user-facing areas:

- account signup, login, password recovery
- dashboard with pending project invites
- collaborator management
- access/role management
- template management
- project creation and project detail view
- project task workspace with kanban, mind map, and gantt tabs
- project-scoped document management

Relevant routes:

- `app/(auth)/login/page.tsx`
- `app/(auth)/signup/page.tsx`
- `app/(auth)/forgot-password/page.tsx`
- `app/(auth)/reset-password/page.tsx`
- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/users/page.tsx`
- `app/(dashboard)/roles/page.tsx`
- `app/(dashboard)/templates/page.tsx`
- `app/(dashboard)/projects/[projectId]/page.tsx`
- `app/(dashboard)/projects/[projectId]/kanban/page.tsx`
- `app/invite/[token]/page.tsx`

## Product Value Framing

This product should be understood as a risk-control and workflow-governance system, not just a productivity dashboard.

The business value comes from reducing:

- rework
- delays
- miscommunication
- poor handoffs
- missing approvals
- missing document traceability
- weak accountability

This is strategically important for the backend because core backend services should optimize for:

- auditability
- traceability
- workflow state integrity
- legally and operationally defensible history
- permission-aware access

In other words, the backend is not only storing data. It is preserving project truth.

## Current Frontend Architecture

The app is a Next.js frontend using Redux Toolkit and browser persistence.

Important current-state facts:

- most domain data is mock-backed and stored in browser local storage
- app state is persisted with Redux persistence
- tenant/workspace selection is derived from the signed-in user's organization, with an active tenant override used during invite acceptance
- permissions are enforced in the frontend using role permission matrices

Relevant files:

- `store/store.ts`
- `lib/tenant.ts`
- `lib/session.ts`
- `lib/permissions.ts`

Backend implication:

- the backend will replace local mock storage as the source of truth
- the backend must be tenant-aware
- the backend must expose permission and membership-aware data, not just raw records

## Core Product Concepts

### 1. Tenant / Organization / Workspace

The frontend uses organization as the tenant boundary.

Current organization fields expected by the frontend:

- `id`
- `organizationName`
- `organizationAddress`
- `organizationCity`
- `organizationCountry`

Behavior:

- signup supports both `INDIVIDUAL` and `ORGANIZATION` account types
- signup creates a workspace/organization context in both cases
- for `ORGANIZATION`, organization details come from the organization form fields
- for `INDIVIDUAL`, the frontend still creates a personal workspace-style organization record derived from the user's identity
- most resources are tenant-scoped
- invite acceptance can switch the active tenant context so a user can access an invited project

Relevant files:

- `modules/auth/interfaces/organization-interface.ts`
- `modules/users/interfaces/organization-interface.ts`
- `lib/tenant.ts`
- `modules/project-management/store/thunks/projects.thunk.ts`

### 2. Users and Access

All users belong to an organization and have a role.

Current frontend user model includes:

- identity: first name, last name, username, email, title
- access: role, roleId, status
- auth flags: `isDefaultPassword`, `twoFactorAuthentication`
- type: `INDIVIDUAL` or `ORGANIZATION`
- organization reference

Profile-like extra attributes also exist for collaborator detail views:

- profession
- specialty
- bio
- organizationName
- organizationWebsite
- teamSize

Relevant files:

- `modules/auth/interfaces/user.interface.ts`
- `modules/users/interfaces/user.interface.ts`
- `modules/users/interfaces/mock-user-profile.interface.ts`
- `modules/users/components/view/view.tsx`

### 3. Roles and Permissions

Roles are organization-scoped and drive UI access.

Current permission domains:

- `projectManagement`
- `changeRequestManagement`
- `taskManagement`
- `documentManagement`
- `userManagement`
- `roleManagement`
- `templateManagement`

Actions per domain:

- `create`
- `update`
- `view`
- `delete`

Important rule already present in the frontend:

- every newly created top-level account should start with the `Admin` role for now

Relevant files:

- `modules/roles/interfaces/role.interface.ts`
- `modules/roles/store/mock/roles-mock-data.ts`
- `lib/permissions.ts`
- `modules/auth/store/thunks/signup.slice.ts`

### 4. Templates

Templates are reusable project blueprints.

Current template model:

- `name`
- `description`
- `isDefault`
- `phases[]`

Each phase currently contains:

- `title`
- `description`

Templates are used during project creation and are displayed on project detail pages.

Relevant files:

- `modules/templates/interfaces/template.interface.ts`
- `modules/templates/interfaces/phase.interface.ts`
- `modules/templates/schemas/create/create.schema.ts`
- `modules/project-management/schemas/create/create.schema.ts`

### 5. Projects

Projects are tenant-scoped and built from templates.

Current project model:

- `id`
- `title`
- `description`
- `startDate`
- `type`
- `template`
- `memberIds`

There is also supporting data around projects:

- memberships
- invites
- contribution history

Relevant files:

- `modules/project-management/interfaces/project.interface.ts`
- `modules/project-management/interfaces/mock-project-membership.interface.ts`
- `modules/project-management/interfaces/mock-project-invite.interface.ts`
- `modules/project-management/interfaces/mock-contribution-event.interface.ts`
- `modules/project-management/components/view/view.tsx`

#### Historical project-management intent

The original product direction for project management included:

- create project with title, description, dates, type, and organization assignment
- define project team with discipline-specific roles
- set project phases from a template with dependencies and deliverables
- track project progress and health indicators
- approve or reject phase completion
- allow external consultants to access limited project material and upload consultation outputs
- close and archive projects as read-only records

Backend implication:

- project lifecycle and project status concepts should be modeled cleanly
- project archival should remain possible as a future capability
- phase completion and phase locking may become first-class workflow rules later
- external consultant access should be considered when designing invite and role models

### 6. Task Domain

The frontend strongly implies that kanban, mind map, and gantt are different views of the same task planning domain.

Backend should not model them as isolated features.

The current task-related surfaces are:

- kanban board for task execution
- mind map for planning and hierarchical structuring
- gantt board for scheduling and dependency visualization

Relevant files:

- `modules/kanban/components/task-views-tabs.component.tsx`
- `modules/kanban/store/interfaces/kanban.types.ts`
- `modules/mindmap/store/interfaces/mindmap.types.ts`
- `modules/gantt/interfaces/gantt.types.ts`

#### Task domain characteristics already visible in the frontend

- tasks have title/name, description, status, assignees, timestamps
- tasks may contain subtasks
- tasks support checklist items
- tasks support comments
- tasks can appear in columns/status lanes
- tasks are associated to projects
- tasks have planning/scheduling fields such as start and end dates
- tasks can have dependencies in gantt
- tasks can have parent-child hierarchy in mind map

Recommended backend interpretation:

- define a normalized task model first
- then define view-specific metadata for kanban, gantt, and mind map

### 7. Documents

The document module is richer than a basic file list. The backend should treat it as a workflow system.

Current document capabilities modeled in the frontend:

- project-scoped documents
- task/subtask ownership
- starter vs deliverable document sets
- document categories
- version history
- review/approval states
- change requests
- distribution logs
- acknowledgements
- audit trail
- sensitive documents with role-aware access

Current document status values:

- `DRAFT`
- `IN_REVIEW`
- `CHANGES_REQUESTED`
- `APPROVED_FOR_USE`
- `ARCHIVED`

Relevant files:

- `modules/documents/store/interfaces/documents.types.ts`
- `modules/documents/components/document-management-board.tsx`
- `modules/documents/store/documents.selectors.ts`

#### Historical document-management intent

The original product direction for document management included:

- upload by category
- multi-version control
- review and approval workflow
- document change requests
- controlled distribution
- role-based access restriction
- archive and retrieval at scale

This aligns closely with the current frontend and confirms that document workflow should be treated as a core backend module, not a generic file attachment feature.

## Functional Requirements

## Authentication and Session

The backend must support:

- signup
- login
- logout or token invalidation strategy
- forgot password
- reset password
- current-session lookup

Frontend assumptions:

- signup supports both `INDIVIDUAL` and `ORGANIZATION`
- after signup or login, the app has immediate access to the authenticated user payload
- protected routes rely on session presence and current user state
- invite flows continue immediately after authentication

Relevant files:

- `modules/auth/forms/signup/signup.tsx`
- `modules/auth/forms/login/signin.tsx`
- `modules/auth/forms/forgot-password/forgot-password.tsx`
- `modules/dashboard/components/require-auth.tsx`
- `app/invite/[token]/page.tsx`

## User and Role Management

The backend must support:

- list collaborators with pagination and search
- fetch single collaborator details
- create collaborator within current organization
- update collaborator
- admin password reset for collaborator
- list roles
- fetch single role
- create role
- update role

Current frontend behavior:

- users and roles are permission-gated
- user create/update forms require role selection
- role forms edit the full permission matrix
- collaborator detail page expects enough data for a meaningful profile and access view

Relevant files:

- `app/(dashboard)/users/page.tsx`
- `app/(dashboard)/roles/page.tsx`
- `modules/users/forms/create/create.form.tsx`
- `modules/users/forms/update/update.form.tsx`
- `modules/users/forms/change-password/change-password.form.tsx`
- `modules/roles/forms/create/create.form.tsx`
- `modules/roles/forms/update/update.form.tsx`

## Template Management

The backend must support:

- list templates
- fetch single template if needed
- create template
- update template
- default template behavior

The current frontend supports template CRUD and uses templates during project creation.

Relevant files:

- `app/(dashboard)/templates/page.tsx`
- `modules/templates/schemas/create/create.schema.ts`
- `modules/templates/schemas/update/update.schema.ts`

## Project Management

The backend must support:

- create project
- update project
- fetch project by id
- list projects for current user/tenant
- project membership resolution
- project invite listing
- contribution trail retrieval

Current frontend expectations:

- a project belongs to a template
- a project has members
- a project can have pending invites
- project detail view shows members, invites, recent contributions, and template summary
- project visibility is membership-aware

Relevant files:

- `modules/project-management/schemas/create/create.schema.ts`
- `modules/project-management/schemas/update/update.schema.ts`
- `modules/project-management/components/view/view.tsx`
- `modules/project-management/components/kanban-guard/kanban-guard.tsx`

## Invite and Membership Flows

The backend must support:

- invite a user to a project
- list invites
- resend invite
- cancel invite
- accept invite by token or invite id
- maintain project membership records

Important behavior already implied by the frontend:

- invite acceptance may happen after login or signup
- invitee may belong to a different active tenant context before accepting
- once accepted, the invited project should become accessible immediately

Relevant files:

- `app/invite/[token]/page.tsx`
- `modules/users/store/thunks/user.thunk.ts`
- `modules/project-management/store/thunks/projects.thunk.ts`

## Task Management

The backend must support a shared task domain that can power:

- kanban operations
- gantt scheduling
- mind map planning

Minimum capabilities implied by the frontend:

- create task
- update task
- delete task
- reorder tasks
- move task between columns/statuses
- create/update/delete columns or workflow stages
- create subtasks and nested subtasks
- toggle completion
- manage checklist items
- add comments
- assign users
- store dates
- store hierarchy and dependencies

Important design recommendation:

- make one canonical project-task service
- expose optional projection/view data for kanban, gantt, and mind map

Why:

- the same project task workspace is rendered through tabs
- duplicated task storage across three backend subsystems would create drift

Relevant files:

- `modules/kanban/components/task-views-tabs.component.tsx`
- `modules/kanban/store/interfaces/kanban.types.ts`
- `modules/mindmap/store/interfaces/mindmap.types.ts`
- `modules/gantt/interfaces/gantt.types.ts`

#### Historical task-management intent

The earlier requirements also expected:

- task attachments and reference documents
- progress percentage updates
- collaboration history
- dependency-aware schedule changes
- review and approval of task completion
- task reassignment with history continuity

Backend implication:

- task events and comments should remain durable
- document linkage to tasks should be first-class
- dependency and review state should not be hard to add later

## Document Management

The backend must support:

- document listing by project and owner scope
- upload initial document
- upload revision/new version
- submit for review
- approve/reject
- create and resolve change requests
- archive
- distribute to recipients
- acknowledge receipt
- audit trail retrieval
- access control for sensitive documents

Important modeling requirements:

- documents are linked to project and task/subtask context
- documents can originate from starter sets or deliverables
- versioning is first-class
- workflow history must be preserved
- audit records are valuable, not optional

Relevant files:

- `modules/documents/store/interfaces/documents.types.ts`
- `modules/documents/components/document-management-board.tsx`

## Deferred or Not Yet Surfaced Modules

The original requirements included additional modules that are not yet represented as full frontend modules in the current codebase, but should be kept in mind for backend extensibility.

### Procurement Management

Originally planned procurement flows included:

- procurement requests
- supplier sourcing and RFQs
- quotation comparison
- purchase orders
- delivery tracking
- invoice linkage
- procurement closeout

Backend implication:

- if naming a generic workflow or approval subsystem, avoid names that only fit projects/tasks/documents
- projects and change workflows may later need procurement integration

### Change Management

Originally planned change-management flows included:

- initiate change requests
- technical review
- cost and time impact analysis
- approval by PM and client representative
- application of approved change to tasks, documents, and procurement
- implementation tracking
- closure and history retention

Backend implication:

- current project, task, and document services should expose identifiers and audit trails in ways that allow a future change-request domain to reference them
- the existing permission domain `changeRequestManagement` suggests this module is still part of the intended architecture even if the frontend UI is not complete yet

### Consultant Access

Originally planned consultation behavior included:

- limited-access consultant login
- controlled document visibility
- download of relevant project files
- upload of consultation outputs

Backend implication:

- invite and role models should support limited-access external users
- document sharing rules should not assume all users are full internal collaborators

## Suggested Backend Domain Model

The frontend suggests these main entities:

- `organizations`
- `users`
- `user_profiles`
- `roles`
- `role_permissions`
- `templates`
- `template_phases`
- `projects`
- `project_memberships`
- `project_invites`
- `contribution_events`
- `workflow_columns` or project/board stage definitions
- `tasks`
- `task_relations` or `task_dependencies`
- `task_comments`
- `task_checklist_items`
- `documents`
- `document_versions`
- `document_change_requests`
- `document_distribution_logs`
- `document_distribution_recipients`
- `document_audit_entries`

## Important Relationships

- one organization has many users
- one organization has many roles
- one organization has many templates
- one organization has many projects
- one user belongs to one organization
- one user has one primary role
- one project belongs to one organization
- one project is created from one template
- many users can belong to many projects through memberships
- one project has many tasks
- one task can have many subtasks
- one task can have many comments and checklist items
- one task can have many related documents
- one document can have many versions, change requests, audit entries, and distributions

## API Contract Guidance

The backend should favor response shapes that minimize frontend rework.

In practice that means:

- return nested `organization` on user payloads
- return nested `role` and `roleId` on user payloads
- return permission matrices on role payloads
- return project details with enough template/member/invite context for the project detail page
- return paginated list responses consistently

Recommended list response shape:

```json
{
  "items": [],
  "count": 0,
  "pages": 1,
  "page": 1,
  "limit": 10
}
```

## Multi-Tenant and Authorization Requirements

The backend must enforce tenant-aware access control.

Required rules implied by the frontend:

- users should only access resources belonging to their organization unless a valid invited flow grants access
- project access should be membership-aware
- roles are organization-scoped
- permissions should be evaluated per role
- sensitive documents should support stricter access rules

Note:

the frontend currently uses a permission matrix for UI gating, but the backend must still enforce authorization server-side.

## Non-Functional Requirements

The backend should be designed for production use, not just parity with the mock layer.

Recommended non-functional requirements:

- centralized persistence in a real database
- auditability for important state transitions
- consistent validation
- stable identifiers
- pagination on list endpoints
- file storage integration for documents
- tenant-safe querying
- transactional integrity for workflows like signup, invite acceptance, and approval flows
- append-only or well-preserved history for key workflow events where feasible
- future-proof naming and modularity so procurement and change management can be added without major refactors

## Backend Delivery Priorities

Recommended delivery order:

1. authentication and current-user endpoints
2. organizations, users, roles, and permissions
3. templates
4. projects, memberships, invites
5. canonical task service
6. kanban/gantt/mind map projections or APIs
7. document workflows and file storage
8. audit and contribution history

## Immediate Product Rule to Preserve

For now, every newly created account should be assigned the `Admin` role at signup.

This applies to both signup paths:

- `INDIVIDUAL` signup
- `ORGANIZATION` signup

That should remain true until product rules change.

Detailed auth and user-management handoff:

- `docs/backend-auth-users-handoff.md`

## Known Frontend Constraints and Gaps

These are useful for backend planning:

- some search UI exists but is not yet fully wired to real backend search
- data is currently browser-persisted, so backend integration will likely require thunk/service rewrites
- task, gantt, and mind map state are still partly view-oriented, so backend normalization decisions matter
- documents are modeled richly, but real file upload/storage/processing is not yet implemented
- procurement and change-management intent exist in product history, but are not yet fully represented in the current frontend module set

## Summary for Backend Agent

The frontend is already expressing a real SaaS workflow system with tenant isolation, RBAC, projects, planning, and document control.

The backend should therefore provide:

- a tenant-aware core domain
- RBAC and membership-aware authorization
- a normalized project-task model
- template-driven project creation
- first-class document workflow support
- consistent API responses that match current frontend expectations

If the backend is modeled this way, the frontend can evolve from mock persistence to production services without changing the product concept.
