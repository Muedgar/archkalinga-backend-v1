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
- delete project
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
- project roles and permissions should be resolved from project membership
- project start and end dates should be validated consistently
- template changes should be blocked after project tasks have already been seeded
- deleting a project should delete its dependent memberships, workflow columns, tasks, and related records
- project detail response should include enough data for:
  - members
  - pending/completed invites
  - contribution history
  - template summary

### Recommended sub-resources

- `project_memberships`
- `project_invites`
- `project_activity_logs`

### Future-friendly considerations

- task approval and locking may be introduced later if needed
- project archive/read-only mode should be possible later
- consultant access should be possible through limited roles or external memberships

## 2. Templates CRUD

### Goal

Allow organizations to define reusable project templates that structure project setup.

### Current frontend evidence

- templates page
- create/update template forms
- project creation depends on templates
- project creation uses template tasks to seed project work

Relevant files:

- `app/(dashboard)/templates/page.tsx`
- `modules/templates/interfaces/template.interface.ts`
- `modules/templates/schemas/create/create.schema.ts`
- `modules/templates/schemas/update/update.schema.ts`
- `modules/project-management/schemas/create/create.schema.ts`

### Minimum backend requirements

- list templates
- fetch template by id
- create template
- update template
- delete template
- mark template as default
- enforce tenant ownership

### Template fields required now

- `id`
- `organizationId`
- `name`
- `description`
- `isDefault`
- `tasks`
- `createdAt`
- `updatedAt`

### Template task fields required now

- `id`
- `templateId`
- `name`
- `description`
- `subtasks`
- `order`

### Template subtask fields required now

- `id`
- `templateTaskId` or `parentTemplateTaskId`
- `name`
- `description`
- `subtasks`
- `order`

### Important behavior

- project creation currently selects template by name in the frontend, but backend should prefer stable `templateId`
- one default template per organization is a sensible backend rule
- deleting a template should be blocked when it is already used by a project
- template tasks and subtasks should be returned in stable order
- template tasks and subtasks are structure-only and must not carry assignees, reportees, checklist items, comments, or dates
- when a project is created from a template, template tasks must seed the project Kanban board automatically
- each template task becomes a project task
- each nested template subtask becomes a nested project task under its parent
- generated tasks should start in the `Todo` column, or the first available column if `Todo` does not exist
- generated tasks and subtasks should start unassigned with empty checklist/comments and no dates

### Future-friendly considerations

- original requirements also implied richer workflow structure and deliverables
- backend design should leave room for:
  - task dependency rules
  - task-linked deliverables
  - project-specific completion states and approval flows

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
- `workspace_roles`
- `project_memberships`
- `project_roles`
- `project_invites`

### Membership fields required now

- `id`
- `projectId`
- `userId`
- `projectRoleId`
- nested `projectRole`
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
- `projectRoleId`
- nested `projectRole`
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
- invite acceptance should assign the invited project role to the created or reactivated membership
- project roles and permissions should apply only within the invited project
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

### Frontend Contract TODO For Kanban And Gantt

This handoff reflects the actual workflow rule now in effect:

- every task and subtask must have assigned members
- each assigned member must carry project-role context
- every task and subtask must have a reportee
- the reportee must also carry project-role context

The current frontend can keep moving, but Kanban and Gantt will not be fully correct until the backend contract supports that structure consistently.

#### 1. Project detail membership roles

Current gap:
`GET /projects/:id` returns `members[]`, but each member must include project membership role linkage.

Required endpoint:

- `GET /projects/:id`

Required response shape:

```json
{
  "id": "project-uuid",
  "title": "Creek Villas",
  "members": [
    {
      "id": "user-uuid",
      "firstName": "Super",
      "lastName": "Admin",
      "email": "admin@archkalinga.com",
      "projectRoleId": "owner-role-uuid",
      "projectRole": {
        "id": "owner-role-uuid",
        "name": "Owner",
        "slug": "owner",
        "status": true,
        "permissions": {
          "taskManagement": {
            "view": true,
            "create": true,
            "update": true,
            "delete": true
          },
          "projectManagement": {
            "view": true,
            "create": true,
            "update": true,
            "delete": true
          },
          "documentManagement": {
            "view": true,
            "create": true,
            "update": true,
            "delete": true
          },
          "changeRequestManagement": {
            "view": true,
            "create": true,
            "update": true,
            "delete": true
          }
        }
      }
    }
  ]
}
```

Why frontend needs it:

- project page access
- kanban page access
- member role display
- task assignment role pickers

#### 2. Task read contract

Current gap:
Task payloads cannot be just `assigneeUserIds`. Tasks and subtasks must expose assigned members and reportee with project-role context.

Required endpoints:

- `GET /projects/:projectId/tasks`
- `GET /projects/:projectId/tasks/:taskId`

Required response shape:

```json
{
  "id": "task-uuid",
  "parentTaskId": null,
  "title": "Concept Design",
  "description": "Prepare first concept set",
  "status": "IN_PROGRESS",
  "workflowColumnId": "column-uuid",
  "priority": "HIGH",
  "startDate": "2026-04-08",
  "endDate": "2026-04-16",
  "progress": 45,
  "assignedMembers": [
    {
      "userId": "user-uuid",
      "projectRoleId": "contributor-role-uuid",
      "projectRole": {
        "id": "contributor-role-uuid",
        "name": "Contributor",
        "slug": "contributor"
      }
    }
  ],
  "reportee": {
    "userId": "manager-user-uuid",
    "projectRoleId": "project-admin-role-uuid",
    "projectRole": {
      "id": "project-admin-role-uuid",
      "name": "Project Admin",
      "slug": "project-admin"
    }
  },
  "checklistItems": [],
  "comments": [],
  "dependencies": [],
  "createdAt": "2026-04-05T11:00:00.000Z",
  "updatedAt": "2026-04-05T11:10:00.000Z"
}
```

Why frontend needs it:

- render assignees correctly
- render reportee correctly
- preserve project-role-aware task ownership
- keep Kanban and Gantt rows consistent

#### 3. Task create

Current gap:
Create payload must require assigned members and reportee, not only plain user arrays.

Required endpoint:

- `POST /projects/:projectId/tasks`

Sample request:

```json
{
  "parentTaskId": null,
  "title": "Concept Design",
  "description": "Prepare first concept set",
  "status": "TODO",
  "workflowColumnId": "todo-column-uuid",
  "priority": "HIGH",
  "startDate": "2026-04-08",
  "endDate": "2026-04-16",
  "progress": 0,
  "assignedMembers": [
    {
      "userId": "user-uuid",
      "projectRoleId": "contributor-role-uuid"
    }
  ],
  "reportee": {
    "userId": "manager-user-uuid",
    "projectRoleId": "project-admin-role-uuid"
  },
  "dependencyIds": []
}
```

Sample subtask request:

```json
{
  "parentTaskId": "parent-task-uuid",
  "title": "Collect references",
  "description": "Gather reference images",
  "status": "TODO",
  "workflowColumnId": "todo-column-uuid",
  "startDate": "2026-04-08",
  "endDate": "2026-04-09",
  "assignedMembers": [
    {
      "userId": "user-uuid",
      "projectRoleId": "contributor-role-uuid"
    }
  ],
  "reportee": {
    "userId": "manager-user-uuid",
    "projectRoleId": "owner-role-uuid"
  }
}
```

Why frontend needs it:

- Kanban create task
- Kanban create subtask
- Gantt create and edit scheduling rows

#### 4. Task update

Current gap:
Update must preserve the same assignment and reportee structure as create.

Required endpoint:

- `PATCH /projects/:projectId/tasks/:taskId`

Sample request:

```json
{
  "title": "Concept Design Revised",
  "description": "Updated scope",
  "status": "IN_PROGRESS",
  "workflowColumnId": "in-progress-column-uuid",
  "priority": "URGENT",
  "startDate": "2026-04-09",
  "endDate": "2026-04-18",
  "progress": 60,
  "assignedMembers": [
    {
      "userId": "user-uuid",
      "projectRoleId": "contributor-role-uuid"
    },
    {
      "userId": "second-user-uuid",
      "projectRoleId": "viewer-role-uuid"
    }
  ],
  "reportee": {
    "userId": "manager-user-uuid",
    "projectRoleId": "owner-role-uuid"
  },
  "dependencyIds": ["other-task-uuid"]
}
```

Why frontend needs it:

- task detail save
- subtask edit save
- Gantt resize, move, and date edit save
- assignment changes

#### 5. Workflow columns

Current gap:
Column create, update, move, and delete are still frontend-only.

Required endpoints:

- `GET /projects/:projectId/columns`
- `POST /projects/:projectId/columns`
- `PATCH /projects/:projectId/columns/:columnId`
- `DELETE /projects/:projectId/columns/:columnId`

Create request:

```json
{
  "name": "In Progress",
  "statusKey": "IN_PROGRESS",
  "orderIndex": 1,
  "wipLimit": 5
}
```

Update request:

```json
{
  "name": "Review",
  "statusKey": "IN_REVIEW",
  "orderIndex": 2,
  "wipLimit": 3
}
```

Expected column:

```json
{
  "id": "column-uuid",
  "name": "Todo",
  "statusKey": "TODO",
  "orderIndex": 0,
  "wipLimit": null,
  "locked": false
}
```

Why frontend needs it:

- full Kanban column management

#### 6. Task move / reorder

Current gap:
Must stay reliable for Kanban drag-and-drop and subtask reparenting.

Required endpoint:

- `PATCH /projects/:projectId/tasks/:taskId/position`

Sample request:

```json
{
  "parentTaskId": null,
  "workflowColumnId": "review-column-uuid",
  "beforeTaskId": "task-before-uuid",
  "afterTaskId": "task-after-uuid"
}
```

Sample subtask move:

```json
{
  "parentTaskId": "new-parent-task-uuid",
  "workflowColumnId": "todo-column-uuid",
  "beforeTaskId": null,
  "afterTaskId": null
}
```

Why frontend needs it:

- Kanban drag
- future Gantt structural moves

#### 7. Task delete

Current gap:
Delete flow is not fully integrated.

Required endpoint:

- `DELETE /projects/:projectId/tasks/:taskId`

Expected response:

```json
{
  "success": true,
  "id": "task-uuid",
  "deletedTaskCount": 1
}
```

Why frontend needs it:

- task and subtask removal from Kanban and Gantt

#### 8. Checklist

Current gap:
Checklist is partially integrated, but needs stable full CRUD contract.

Required endpoints:

- `GET /projects/:projectId/tasks/:taskId/checklist`
- `POST /projects/:projectId/tasks/:taskId/checklist`
- `PATCH /projects/:projectId/tasks/:taskId/checklist/:itemId`
- `DELETE /projects/:projectId/tasks/:taskId/checklist/:itemId`

Create request:

```json
{
  "text": "Upload survey",
  "orderIndex": 0
}
```

Update request:

```json
{
  "text": "Upload revised survey",
  "completed": true,
  "orderIndex": 0
}
```

Expected item:

```json
{
  "id": "check-uuid",
  "text": "Upload revised survey",
  "completed": true,
  "orderIndex": 0
}
```

Why frontend needs it:

- task detail sheet
- subtask detail tree
- filter "incomplete checklist only"

#### 9. Comments

Current gap:
Comment add is integrated, but full contract should be stable for list, update, and delete.

Required endpoints:

- `GET /projects/:projectId/tasks/:taskId/comments`
- `POST /projects/:projectId/tasks/:taskId/comments`
- `PATCH /projects/:projectId/tasks/:taskId/comments/:commentId`
- `DELETE /projects/:projectId/tasks/:taskId/comments/:commentId`

Create request:

```json
{
  "body": "Please revise the parking layout."
}
```

Update request:

```json
{
  "body": "Please revise the parking layout and access path."
}
```

Expected comment:

```json
{
  "id": "comment-uuid",
  "body": "Please revise the parking layout and access path.",
  "authorUserId": "user-uuid",
  "author": {
    "id": "user-uuid",
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane@example.com",
    "title": "Project Architect"
  },
  "createdAt": "2026-04-05T11:20:00.000Z"
}
```

Why frontend needs it:

- task detail sheet
- subtask detail tree

#### 10. Dependencies

Current gap:
Dependencies are not fully usable in frontend yet, but Gantt depends on them.

Required endpoints:

- `GET /projects/:projectId/tasks/:taskId/dependencies`
- `POST /projects/:projectId/tasks/:taskId/dependencies`
- `DELETE /projects/:projectId/tasks/:taskId/dependencies/:depId`

Create request:

```json
{
  "dependsOnTaskId": "predecessor-task-uuid",
  "dependencyType": "FS",
  "lagDays": 2
}
```

Expected dependency:

```json
{
  "id": "dep-uuid",
  "taskId": "task-uuid",
  "dependsOnTaskId": "predecessor-task-uuid",
  "dependencyType": "FS",
  "lagDays": 2,
  "dependsOnTask": {
    "id": "predecessor-task-uuid",
    "title": "Site Clearance",
    "status": "DONE",
    "startDate": "2026-04-01",
    "endDate": "2026-04-05"
  }
}
```

Why frontend needs it:

- real Gantt chart sequencing
- dependency-aware scheduling

#### 11. Task search / filters

Current gap:
Filters are still frontend-only.

Required endpoint:

- `GET /projects/:projectId/tasks`

Recommended query params:

- `search`
- `status`
- `workflowColumnId`
- `assignedUserId`
- `reporteeUserId`
- `projectRoleId`
- `parentTaskId`
- `flat`
- `include`
- `startDateFrom`
- `startDateTo`
- `endDateFrom`
- `endDateTo`
- `hasIncompleteChecklist`
- `page`
- `limit`

Example:

```http
GET /projects/:projectId/tasks?page=1&limit=100&flat=true&search=survey&status=IN_PROGRESS&assignedUserId=user-uuid&workflowColumnId=todo-column-uuid&include=assignedMembers,reportee,checklist,comments,dependencies
```

Why frontend needs it:

- scalable Kanban search and filtering
- scalable Gantt filtering

#### 12. Gantt scheduling contract

Current gap:
Gantt needs scheduling fields plus assignment, reportee, and dependencies in one consistent read model.

Required task response fields:

- `id`
- `parentTaskId`
- `title`
- `startDate`
- `endDate`
- `progress`
- `status`
- `assignedMembers`
- `reportee`
- `dependencies`
- optional `viewMeta.gantt`

Sample:

```json
{
  "id": "task-uuid",
  "parentTaskId": null,
  "title": "Foundation Layout",
  "startDate": "2026-04-10",
  "endDate": "2026-04-18",
  "progress": 35,
  "status": "IN_PROGRESS",
  "workflowColumnId": "in-progress-column-uuid",
  "assignedMembers": [
    {
      "userId": "user-uuid",
      "projectRoleId": "contributor-role-uuid",
      "projectRole": {
        "id": "contributor-role-uuid",
        "name": "Contributor",
        "slug": "contributor"
      }
    }
  ],
  "reportee": {
    "userId": "manager-user-uuid",
    "projectRoleId": "owner-role-uuid",
    "projectRole": {
      "id": "owner-role-uuid",
      "name": "Owner",
      "slug": "owner"
    }
  },
  "dependencies": [
    {
      "id": "dep-uuid",
      "dependsOnTaskId": "site-clearance-task-uuid",
      "dependencyType": "FS",
      "lagDays": 1
    }
  ],
  "viewMeta": {
    "gantt": {
      "barColor": "#2563EB"
    }
  }
}
```

Why frontend needs it:

- usable Gantt chart
- dependency lines
- scheduling edits
- assignment and reporting visibility in timeline views

#### Recommended delivery order

1. Fix `GET /projects/:id` member role linkage
2. Finalize task read contract with `assignedMembers` and `reportee`
3. Finalize task create and update contract with the same structure
4. Finish column CRUD support
5. Finish task delete
6. Finish dependency CRUD
7. Add server-side filters and search
8. Finalize Gantt scheduling fields and behavior

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
