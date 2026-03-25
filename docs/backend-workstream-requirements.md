# Backend Workstream Requirements

## Purpose

This document reorganizes the backend requirements into six implementation workstreams based on:

- the current frontend behavior
- the historical product intent
- the minimum backend needed to support the existing and intended user journeys

These workstreams are:

1. Project management
2. Templates CRUD
3. Collaborator management per project
4. Task management
5. Document management per task / subtask
6. Change management per task / subtask

This document is a planning companion to:

- `docs/backend-context-requirements.md`
- `docs/backend-auth-users-handoff.md`

## 1. Project Management

### Goal

Enable creation, configuration, lifecycle management, and visibility of projects inside a tenant-aware workspace.

### Current frontend evidence

- dashboard project entry point
- project detail page
- project creation and update flows
- project membership and invite display
- project access guard before task workspace is shown

Relevant files:

- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/projects/[projectId]/page.tsx`
- `modules/project-management/components/view/view.tsx`
- `modules/project-management/components/kanban-guard/kanban-guard.tsx`
- `modules/project-management/schemas/create/create.schema.ts`
- `modules/project-management/schemas/update/update.schema.ts`

### Minimum backend requirements

- create project
- update project
- fetch project by id
- list visible projects for current user
- link project to organization
- link project to template
- maintain project members
- maintain project invites
- maintain project contribution history

### Project fields required now

- `id`
- `organizationId`
- `title`
- `description`
- `startDate`
- `endDate` recommended addition from original product intent
- `type`
- `templateId`
- `status` recommended for lifecycle
- `archivedAt` nullable
- `createdAt`
- `updatedAt`

### Important behavior

- project visibility must be membership-aware
- invited users should gain access immediately after accepting an invite
- project detail response should include enough data for:
  - members
  - pending/completed invites
  - contribution history
  - template summary

### Recommended sub-resources

- `project_memberships`
- `project_invites`
- `project_activity_logs`
- optionally `project_phases` if phase tracking is made explicit

### Future-friendly considerations

- phase approval and locking were part of original requirements
- project archive/read-only mode should be possible later
- consultant access should be possible through limited roles or external memberships

## 2. Templates CRUD

### Goal

Allow organizations to define reusable project templates that structure project setup.

### Current frontend evidence

- templates page
- create/update template forms
- project creation depends on templates
- project view renders template summary and phases

Relevant files:

- `app/(dashboard)/templates/page.tsx`
- `modules/templates/interfaces/template.interface.ts`
- `modules/templates/interfaces/phase.interface.ts`
- `modules/templates/schemas/create/create.schema.ts`
- `modules/templates/schemas/update/update.schema.ts`
- `modules/project-management/schemas/create/create.schema.ts`

### Minimum backend requirements

- list templates
- fetch template by id
- create template
- update template
- mark template as default
- enforce tenant ownership

### Template fields required now

- `id`
- `organizationId`
- `name`
- `description`
- `isDefault`
- `createdAt`
- `updatedAt`

### Phase fields required now

- `id`
- `templateId`
- `title`
- `description`
- `order`

### Important behavior

- project creation currently selects template by name in the frontend, but backend should prefer stable `templateId`
- one default template per organization is a sensible backend rule
- phases should be returned in stable order

### Future-friendly considerations

- original requirements also implied phase dependencies and deliverables
- backend design should leave room for:
  - phase dependency rules
  - phase deliverables
  - phase completion states per project

## 3. Collaborator Management Per Project

### Goal

Support assigning and controlling who can access and work inside a project.

### Scope note

The frontend already has tenant-level collaborator management and project-level invite/membership behavior. At minimum, backend should implement the intended per-project collaborator model even if some UI screens are still general-purpose.

### Current frontend evidence

- global collaborator management
- project members shown in project detail
- project invites shown in project detail and dashboard
- invite acceptance flow

Relevant files:

- `app/(dashboard)/users/page.tsx`
- `modules/users/store/thunks/user.thunk.ts`
- `modules/project-management/components/view/view.tsx`
- `app/invite/[token]/page.tsx`
- `modules/project-management/store/thunks/projects.thunk.ts`

### Minimum backend requirements

- list organization collaborators
- invite collaborator to project
- list project collaborators
- list project invites
- resend invite
- cancel invite
- accept invite
- remove collaborator from project
- update collaborator project role if needed

### Core entities

- `users`
- `roles`
- `project_memberships`
- `project_invites`

### Membership fields required now

- `id`
- `projectId`
- `userId`
- `role` or `projectRole`
- `status`
- `invitedByUserId`
- `inviteId` nullable
- `joinedAt`
- `removedAt` nullable
- `createdAt`
- `updatedAt`

### Invite fields required now

- `id`
- `projectId`
- `inviterUserId`
- `inviteeEmail`
- `inviteeUserId` nullable
- `role`
- `token`
- `status`
- `expiresAt`
- `acceptedAt` nullable
- `createdAt`
- `updatedAt`

### Important behavior

- a collaborator may exist in the organization but not yet belong to a given project
- project access should be driven by membership, not only organization membership
- invite acceptance must be token-driven and survive auth redirects
- consultant-style limited access should be possible later without redesigning memberships

## 4. Task Management

### Goal

Provide one canonical project-task domain that powers kanban, mind map, and gantt views.

### Current frontend evidence

- tabbed task workspace
- kanban board with tasks, subtasks, checklist items, comments, and members
- mind map planning surface
- gantt scheduling surface

Relevant files:

- `app/(dashboard)/projects/[projectId]/kanban/page.tsx`
- `modules/kanban/components/task-views-tabs.component.tsx`
- `modules/kanban/store/interfaces/kanban.types.ts`
- `modules/mindmap/store/interfaces/mindmap.types.ts`
- `modules/gantt/interfaces/gantt.types.ts`
- `modules/task-core/store/interfaces/task-core.types.ts`

### Minimum backend requirements

- create task
- update task
- delete task
- fetch project tasks
- reorder tasks
- move tasks across workflow columns/statuses
- create subtasks
- support nested subtasks
- assign users
- manage checklist items
- manage comments
- store task dates
- store task hierarchy
- store dependencies

### Canonical task fields recommended

- `id`
- `projectId`
- `parentTaskId` nullable
- `title`
- `description`
- `status`
- `startDate` nullable
- `endDate` nullable
- `progress` nullable
- `completed` boolean or derived
- `createdByUserId`
- `createdAt`
- `updatedAt`

### Supporting task entities

- `task_assignees`
- `task_checklist_items`
- `task_comments`
- `task_dependencies`
- `workflow_columns`
- optionally `task_view_metadata`

### View-specific data recommendations

Kanban:

- column placement
- ordering/rank
- WIP rules

Mind map:

- position
- collapse state
- edge relationships

Gantt:

- dependency type
- lag
- baseline dates
- grouping/projection metadata

### Important behavior

- backend should avoid separate persistence silos for kanban, mind map, and gantt
- comments and checklist history should remain durable
- document links and change requests should reference task or subtask ids cleanly

## 5. Document Management Per Task / Subtask

### Goal

Support controlled project documents attached to a task or subtask with strong workflow traceability.

### Current frontend evidence

- document board scoped by project and task
- support for owner type task or subtask
- starter and deliverable document sets
- versions, approvals, change requests, distributions, acknowledgements

Relevant files:

- `modules/documents/store/interfaces/documents.types.ts`
- `modules/documents/components/document-management-board.tsx`
- `modules/documents/store/documents.selectors.ts`

### Minimum backend requirements

- list documents by project
- filter by task or subtask owner
- upload initial document
- upload revised version
- update metadata
- submit for review
- approve or reject
- archive
- distribute to recipients
- acknowledge receipt
- fetch audit trail

### Document fields required now

- `id`
- `projectId`
- `taskId`
- `ownerType` as `task | subtask`
- `ownerTaskId`
- `ownerSubtaskId` nullable
- `setType` as `starter | deliverable`
- `sourceDocumentId` nullable
- `name`
- `title`
- `description`
- `category`
- `sensitive`
- `status`
- `currentVersion`
- `createdBy`
- `createdAt`
- `updatedAt`

### Supporting entities

- `document_versions`
- `document_audit_entries`
- `document_distribution_logs`
- `document_distribution_recipients`

### Important behavior

- documents must be queryable per task and subtask
- versions must not overwrite history
- sensitive documents must respect stricter access checks
- distribution and acknowledgement history should remain durable

### Storage recommendation

- metadata in relational database
- binary files in object storage
- immutable version references once uploaded

## 6. Change Management Per Task / Subtask

### Goal

Support structured change requests tied to task or subtask work items, with clear approval and implementation traceability.

### Scope note

The frontend does not yet expose a full change-management UI, but:

- the permission domain `changeRequestManagement` already exists
- document change requests already exist in the document workflow
- original product requirements clearly intended a broader change-management module

This should be treated as an intended backend capability, even if delivered after the other five workstreams.

### Intended minimum backend requirements

- create change request for a task or subtask
- attach reason and supporting references
- fetch change requests by project/task/subtask
- perform technical review
- capture impact notes for time/cost/scope
- approve or reject change request
- mark approved change as applied
- track implementation progress
- close and archive change request

### Recommended change-request fields

- `id`
- `projectId`
- `taskId` nullable
- `subtaskId` nullable
- `requestedByUserId`
- `reason`
- `description`
- `status`
- `technicalReviewSummary` nullable
- `timeImpactSummary` nullable
- `costImpactSummary` nullable
- `approvalDecisionByUserId` nullable
- `approvalDecisionAt` nullable
- `resolutionNote` nullable
- `implementedAt` nullable
- `closedAt` nullable
- `createdAt`
- `updatedAt`

### Recommended supporting entities

- `change_request_attachments`
- `change_request_comments`
- `change_request_impacted_tasks`
- `change_request_impacted_documents`
- `change_request_audit_entries`

### Important behavior

- a change request should be able to reference both tasks and related documents
- change request status should be workflow-driven
- approval history must be retained
- approved changes should be able to trigger downstream updates in tasks or documents

### Relationship to document change requests

There are two layers to distinguish:

- document-level change request inside the document workflow
- broader task/subtask-level change request affecting execution, schedule, and possibly documents

Backend should model these as related but not identical concepts.

## Recommended Delivery Order

1. Templates CRUD
2. Project management
3. Collaborator management per project
4. Task management
5. Document management per task / subtask
6. Change management per task / subtask

## Final Guidance

The safest backend design is:

- tenant-aware from day one
- role and membership aware
- built around a canonical project-task domain
- document-history preserving
- extensible enough to absorb change management and later procurement workflows

This will match the current frontend while staying aligned with the original product direction.
