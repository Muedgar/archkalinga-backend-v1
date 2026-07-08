# Change Request Backend API Requirements And Implementation Order

## 1. Purpose

Build a fully functioning backend API for task-scoped change requests.

A change request is a formal conversation workflow attached to one task. It starts a new chat thread, allows task participants to discuss the request with text and attachments, can be escalated to the parent task's reportee, and is resolved only by the task reportee.

This module is separate from document-only change requests. A task change request may reference documents or attach supporting files, but the primary owner is the task.

## 2. Core Rules

### 2.1 Task Scope

- Each change request belongs to exactly one task.
- A task can have multiple historical change requests over time.
- Each change request owns exactly one thread.
- Creating a new change request always creates a new thread.
- A thread is never reused across different change requests.

### 2.2 Actors

For the task connected to the change request:

- `assignee`: a user assigned to the task through `task_assignees`.
- `reportee`: the task's `reporteeUserId`.
- `creator`: the user who created the change request.
- `escalatedReportee`: the reportee of the parent task, when escalation exists.

### 2.3 Who Can Create

A change request can be created by:

- a task assignee
- the task reportee

Project admins or users with broad project visibility may view through existing project permissions, but they should not bypass the business rule for creating unless the product explicitly chooses that later.

### 2.4 Who Can Message

A user can post thread messages if they can access the change request thread:

- creator
- task assignee
- task reportee
- escalated parent-task reportee after escalation

Messages can include text, attachments, or both. At least one of text or attachments is required.

### 2.5 Who Can Escalate

A change request can be escalated by:

- task assignee
- task reportee

Escalation target:

- the reportee of the parent task

Escalation is blocked when:

- the task has no parent task
- the parent task has no reportee
- the request is already resolved
- the current user is not the task assignee or task reportee

When escalation succeeds:

- status becomes `ESCALATED`
- `escalatedToUserId` is set to the parent task reportee
- `escalatedAt` is set
- an escalation message is inserted in the same thread
- the escalated reportee gets access to the full thread history, including prior messages and attachments

### 2.6 Who Can Resolve

Only the change request's task reportee can resolve the request.

Resolution is blocked when:

- the current user is not the task reportee
- the request is already resolved
- required resolution text is missing

When resolution succeeds:

- status becomes `RESOLVED`
- `resolvedByUserId` is set to the task reportee
- `resolvedAt` is set
- a resolution message is inserted in the same thread

## 3. Status Model

Use a small workflow first:

- `NEW`
- `ESCALATED`
- `RESOLVED`

Recommended enum:

```ts
export enum ChangeRequestStatus {
  NEW = 'NEW',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
}
```

Allowed transitions:

| From | Action | To | Actor |
| --- | --- | --- | --- |
| none | create | `NEW` | task assignee or task reportee |
| `NEW` | escalate | `ESCALATED` | task assignee or task reportee |
| `ESCALATED` | escalate | `ESCALATED` | task assignee or task reportee |
| `NEW` | resolve | `RESOLVED` | task reportee |
| `ESCALATED` | resolve | `RESOLVED` | task reportee |

Do not allow messages to change status by themselves. Status changes should happen through explicit create, escalate, and resolve actions.

## 4. Data Model

### 4.1 `change_requests`

Primary workflow record.

Recommended columns:

- `pkid` serial primary key
- `id` uuid unique default `uuid_generate_v4()`
- `version` integer
- `project_id` uuid not null, FK `projects(id)` on delete cascade
- `task_id` uuid not null, FK `tasks(id)` on delete cascade
- `created_by_user_id` uuid not null, FK `users(id)` on delete restrict
- `status` enum not null default `NEW`
- `title` varchar(255) not null
- `description` text nullable
- `escalated_to_user_id` uuid nullable, FK `users(id)` on delete set null
- `escalated_at` timestamptz nullable
- `resolved_by_user_id` uuid nullable, FK `users(id)` on delete set null
- `resolved_at` timestamptz nullable
- `created_at` timestamptz
- `updated_at` timestamptz

Recommended indexes:

- `idx_change_requests_project_status` on `(project_id, status)`
- `idx_change_requests_task_status` on `(task_id, status)`
- `idx_change_requests_created_by` on `(created_by_user_id)`
- `idx_change_requests_escalated_to` on `(escalated_to_user_id)`
- `idx_change_requests_resolved_by` on `(resolved_by_user_id)`

### 4.2 `change_request_threads`

The conversation container for one change request.

Recommended columns:

- `pkid` serial primary key
- `id` uuid unique default `uuid_generate_v4()`
- `version` integer
- `change_request_id` uuid not null unique, FK `change_requests(id)` on delete cascade
- `task_id` uuid not null, FK `tasks(id)` on delete cascade
- `project_id` uuid not null, FK `projects(id)` on delete cascade
- `created_by_user_id` uuid not null, FK `users(id)` on delete restrict
- `created_at` timestamptz
- `updated_at` timestamptz

Recommended indexes:

- `idx_change_request_threads_project` on `(project_id)`
- `idx_change_request_threads_task` on `(task_id)`

### 4.3 `change_request_thread_messages`

Thread messages, including normal messages, escalation notes, and resolution notes.

Recommended message types:

```ts
export enum ChangeRequestMessageType {
  MESSAGE = 'MESSAGE',
  ESCALATION = 'ESCALATION',
  RESOLUTION = 'RESOLUTION',
  SYSTEM = 'SYSTEM',
}
```

Recommended columns:

- `pkid` serial primary key
- `id` uuid unique default `uuid_generate_v4()`
- `version` integer
- `thread_id` uuid not null, FK `change_request_threads(id)` on delete cascade
- `change_request_id` uuid not null, FK `change_requests(id)` on delete cascade
- `author_user_id` uuid not null, FK `users(id)` on delete restrict
- `type` enum not null default `MESSAGE`
- `body` text nullable
- `metadata` jsonb nullable
- `created_at` timestamptz
- `updated_at` timestamptz

Recommended indexes:

- `idx_change_request_messages_thread_created` on `(thread_id, created_at)`
- `idx_change_request_messages_change_request` on `(change_request_id)`
- `idx_change_request_messages_author` on `(author_user_id)`

Validation:

- `body` can be null only when at least one attachment exists for the message.
- For `ESCALATION`, body is required.
- For `RESOLUTION`, body is required.

### 4.4 `change_request_message_attachments`

Files attached to individual messages.

Recommended columns:

- `pkid` serial primary key
- `id` uuid unique default `uuid_generate_v4()`
- `version` integer
- `message_id` uuid not null, FK `change_request_thread_messages(id)` on delete cascade
- `change_request_id` uuid not null, FK `change_requests(id)` on delete cascade
- `created_by_user_id` uuid not null, FK `users(id)` on delete restrict
- `bucket_name` varchar(255) not null
- `filename` varchar(512) not null
- `original_name` varchar(255) not null
- `mime_type` varchar(255) nullable
- `size_bytes` bigint nullable
- `notes` text nullable
- `created_at` timestamptz
- `updated_at` timestamptz

Recommended indexes:

- `idx_change_request_attachments_message` on `(message_id)`
- `idx_change_request_attachments_change_request` on `(change_request_id)`
- `idx_change_request_attachments_created_by` on `(created_by_user_id)`

### 4.5 Optional `change_request_audit_entries`

This can be deferred if `TaskActivityService` or `ProjectActivityLog` already captures enough action history.

Recommended only if the frontend needs a dedicated timeline:

- `change_request_id`
- `actor_user_id`
- `action`
- `from_status`
- `to_status`
- `metadata`
- `created_at`

## 5. Entity Placement

Keep the first implementation inside the existing task bounded context:

- `src/tasks/entities/change-request.entity.ts`
- `src/tasks/entities/change-request-thread.entity.ts`
- `src/tasks/entities/change-request-thread-message.entity.ts`
- `src/tasks/entities/change-request-message-attachment.entity.ts`

Export them from:

- `src/tasks/entities/index.ts`

Register them in:

- `src/tasks/tasks.module.ts`

This fits the existing module because the request is task-scoped and access is driven by task assignee/reportee relationships.

## 6. DTOs

Add DTOs under `src/tasks/dtos`.

### 6.1 Create Change Request

`CreateChangeRequestDto`

- `title`: required string, max 255
- `description`: optional string
- `message`: required unless attachments are present
- `attachmentNotes`: optional string

For multipart create, the initial file can come from `FileInterceptor('file')` first. If multiple files are needed immediately, use `FilesInterceptor('files')` in a second pass.

### 6.2 Add Message

`CreateChangeRequestMessageDto`

- `body`: required unless attachments are present
- `attachmentNotes`: optional string

### 6.3 Escalate

`EscalateChangeRequestDto`

- `message`: required string
- `attachmentNotes`: optional string

### 6.4 Resolve

`ResolveChangeRequestDto`

- `resolution`: required string
- `attachmentNotes`: optional string

### 6.5 List Filters

`ChangeRequestFiltersDto`

- `page`
- `limit`
- `status`
- `taskId`
- `createdByUserId`
- `escalatedToUserId`
- `search`
- `includeMessages`

## 7. Serializers

Add serializers under `src/tasks/serializers`.

### 7.1 `ChangeRequestSerializer`

Expose:

- `id`
- `projectId`
- `taskId`
- `status`
- `title`
- `description`
- `createdBy`
- `escalatedTo`
- `escalatedAt`
- `resolvedBy`
- `resolvedAt`
- `thread`
- `messageCount`
- `latestMessage`
- `createdAt`
- `updatedAt`

### 7.2 `ChangeRequestThreadSerializer`

Expose:

- `id`
- `changeRequestId`
- `taskId`
- `projectId`
- `messages`
- `createdAt`
- `updatedAt`

### 7.3 `ChangeRequestMessageSerializer`

Expose:

- `id`
- `type`
- `body`
- `author`
- `attachments`
- `createdAt`

### 7.4 `ChangeRequestAttachmentSerializer`

Expose:

- `id`
- `originalName`
- `mimeType`
- `sizeBytes`
- `notes`
- `createdBy`
- `createdAt`

Do not expose raw storage filenames unless a backend-only debug view requires them.

## 8. Service Design

### 8.1 Add `TaskChangeRequestsService`

File:

- `src/tasks/services/task-change-requests.service.ts`

Responsibilities:

- create change request and thread in one transaction
- post thread messages
- upload and attach files
- list visible change requests
- get one change request with thread
- escalate request
- resolve request
- return attachment download URLs
- log task activity for create, message, escalate, and resolve

### 8.2 Extend `TasksService` Facade

Add facade methods:

- `listTaskChangeRequests(projectId, taskId, filters, requestUser)`
- `getTaskChangeRequest(projectId, taskId, changeRequestId, requestUser)`
- `createTaskChangeRequest(projectId, taskId, dto, requestUser, file?)`
- `addTaskChangeRequestMessage(projectId, taskId, changeRequestId, dto, requestUser, file?)`
- `escalateTaskChangeRequest(projectId, taskId, changeRequestId, dto, requestUser, file?)`
- `resolveTaskChangeRequest(projectId, taskId, changeRequestId, dto, requestUser, file?)`
- `getTaskChangeRequestAttachmentDownloadUrl(projectId, taskId, changeRequestId, messageId, attachmentId, requestUser)`

The facade should continue the current pattern:

- verify project permission
- ensure the task belongs to the project
- load actor user
- delegate business logic to the focused sub-service

### 8.3 Extend `TaskAuthService`

Add focused helpers:

- `ensureChangeRequestTaskParticipant(task, requestUser)`
- `canAccessChangeRequest(changeRequest, task, requestUser)`
- `canCreateChangeRequest(task, requestUser)`
- `canEscalateChangeRequest(task, requestUser)`
- `canResolveChangeRequest(task, requestUser)`
- `ensureParentTaskReportee(task)`

Rules:

- create: task assignee or task reportee
- message: creator, task assignee, task reportee, or escalated parent-task reportee
- escalate: task assignee or task reportee
- resolve: task reportee only
- escalated reportee can see full thread history

## 9. API Endpoints

Use the same route family as task documents.

Base:

`/projects/:projectId/tasks/:taskId/change-requests`

### 9.1 List Task Change Requests

`GET /projects/:projectId/tasks/:taskId/change-requests`

Permission:

- `changeRequestManagement.view`

Visibility:

- show requests visible to the current user
- include own threads
- include threads where user is task assignee/reportee
- include threads escalated to current user
- project-level view-all users can see all if product wants admin oversight

### 9.2 Get Change Request Detail

`GET /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId`

Permission:

- `changeRequestManagement.view`

Returns:

- change request
- thread
- messages
- attachment metadata

### 9.3 Create Change Request

`POST /projects/:projectId/tasks/:taskId/change-requests`

Consumes:

- `multipart/form-data`

Permission:

- `changeRequestManagement.create`

Business rule:

- actor must be task assignee or task reportee

Behavior:

- create `change_requests`
- create `change_request_threads`
- create initial `MESSAGE`
- upload optional attachment
- return full change request detail

### 9.4 Add Message

`POST /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/messages`

Consumes:

- `multipart/form-data`

Permission:

- `changeRequestManagement.view`

Business rule:

- actor must have thread access
- cannot post to resolved request unless product chooses to allow post-resolution follow-up

Behavior:

- create `MESSAGE`
- upload optional attachment
- return created message or full detail

### 9.5 Escalate

`POST /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/escalate`

Consumes:

- `multipart/form-data`

Permission:

- `changeRequestManagement.update`

Business rule:

- actor must be task assignee or task reportee
- task must have parent task
- parent task must have reportee
- request must not be resolved

Behavior:

- set status `ESCALATED`
- set `escalatedToUserId`
- set `escalatedAt`
- insert `ESCALATION` message
- return full change request detail

### 9.6 Resolve

`POST /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/resolve`

Consumes:

- `multipart/form-data`

Permission:

- `changeRequestManagement.update`

Business rule:

- actor must be the task reportee
- request must not already be resolved

Behavior:

- set status `RESOLVED`
- set `resolvedByUserId`
- set `resolvedAt`
- insert `RESOLUTION` message
- return full change request detail

### 9.7 Attachment Download URL

`GET /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/messages/:messageId/attachments/:attachmentId/download-url`

Permission:

- `changeRequestManagement.view`

Business rule:

- actor must have access to the thread

Behavior:

- return a presigned URL using `MinioService`

## 10. Controller Placement

Add routes to `src/tasks/tasks.controller.ts` near the task-document routes.

Use existing patterns:

- `@UseGuards(ProjectPermissionGuard)`
- `@RequireProjectPermission('changeRequestManagement', 'view' | 'create' | 'update')`
- `@UseInterceptors(FileInterceptor('file'))`
- `@ApiConsumes('multipart/form-data')`
- `@ResponseMessage(...)`
- `@LogActivity(...)`

## 11. Messages

Add success messages:

- `TASK_CHANGE_REQUESTS_FETCHED`
- `TASK_CHANGE_REQUEST_FETCHED`
- `TASK_CHANGE_REQUEST_CREATED`
- `TASK_CHANGE_REQUEST_MESSAGE_CREATED`
- `TASK_CHANGE_REQUEST_ESCALATED`
- `TASK_CHANGE_REQUEST_RESOLVED`
- `TASK_CHANGE_REQUEST_ATTACHMENT_DOWNLOAD_URL_FETCHED`

Add error messages:

- `TASK_CHANGE_REQUEST_NOT_FOUND`
- `TASK_CHANGE_REQUEST_THREAD_NOT_FOUND`
- `TASK_CHANGE_REQUEST_ATTACHMENT_NOT_FOUND`
- `INVALID_CHANGE_REQUEST_CREATE_ACTOR`
- `INVALID_CHANGE_REQUEST_MESSAGE_EMPTY`
- `INVALID_CHANGE_REQUEST_ESCALATION_ACTOR`
- `INVALID_CHANGE_REQUEST_ESCALATION_ROOT_TASK`
- `INVALID_CHANGE_REQUEST_ESCALATION_PARENT_REPORTEE`
- `INVALID_CHANGE_REQUEST_RESOLUTION_ACTOR`
- `INVALID_CHANGE_REQUEST_ALREADY_RESOLVED`
- `TASK_CHANGE_REQUEST_ACCESS_DENIED`

## 12. Migration Requirements

Create a migration similar to existing task sub-table migrations.

Suggested file:

- `src/migrations/<timestamp>-add-task-change-requests.ts`

Migration order:

1. Create enum `change_requests_status_enum`.
2. Create enum `change_request_messages_type_enum`.
3. Create `change_requests`.
4. Create `change_request_threads`.
5. Create `change_request_thread_messages`.
6. Create `change_request_message_attachments`.
7. Create indexes.

Rollback order:

1. Drop attachment table.
2. Drop message table.
3. Drop thread table.
4. Drop change request table.
5. Drop enums.

## 13. Activity And Notifications

Minimum task activity events:

- change request created
- change request message added
- change request escalated
- change request resolved

Recommended notification events:

- when a change request is created, notify the task reportee if creator is an assignee
- when a change request is created by reportee, notify task assignees
- when escalated, notify the parent task reportee
- when resolved, notify creator and task assignees

Notification delivery can be a later enhancement if the existing notification module needs extra event shapes.

## 14. Implementation Order

### Phase 1: Data Model

1. Add change request entities.
2. Export entities from `src/tasks/entities/index.ts`.
3. Register entities in `TasksModule`.
4. Add migration for all change-request tables and indexes.
5. Run migration locally.

Deliverable:

- database schema exists
- app boots with new entities registered

### Phase 2: DTOs, Serializers, Messages

1. Add create, message, escalate, resolve, and filter DTOs.
2. Add serializers for request, thread, message, and attachment.
3. Add success and error message constants.
4. Export DTOs and serializers from their index files.

Deliverable:

- API contracts are typed before service logic lands

### Phase 3: Auth Helpers

1. Add task participant helpers in `TaskAuthService`.
2. Add parent-task reportee loader.
3. Add change-request access checks.
4. Add visibility query logic for list endpoints.

Deliverable:

- business access rules are centralized and reusable

### Phase 4: Core Service

1. Add `TaskChangeRequestsService`.
2. Implement create with transaction and initial thread/message.
3. Implement list and detail fetch.
4. Implement add message.
5. Implement attachment upload and cleanup on transaction failure.
6. Implement attachment download URL.

Deliverable:

- users can create requests, see visible threads, chat, and retrieve attachments

### Phase 5: Workflow Actions

1. Implement escalation.
2. Block escalation for root tasks.
3. Assign escalation to parent task reportee.
4. Ensure escalated reportee sees full thread.
5. Implement resolution by task reportee only.
6. Block resolved requests from escalation or normal message posting unless a later rule permits reopening.

Deliverable:

- full lifecycle works from `NEW` to `ESCALATED` to `RESOLVED`

### Phase 6: Facade And Controller

1. Inject `TaskChangeRequestsService` into `TasksService`.
2. Add facade methods.
3. Add controller routes.
4. Add Swagger decorators and multipart schemas.
5. Add response messages and activity logging decorators.

Deliverable:

- full HTTP API is available under project/task routes

### Phase 7: Activity, Notifications, And Audit

1. Log task activity for create, message, escalation, and resolution.
2. Add notification dispatch for key transitions if notification contracts are ready.
3. Add audit entries only if task activity is not enough for traceability.

Deliverable:

- actions are traceable and relevant users are informed

### Phase 8: Tests And Verification

Minimum service/controller cases:

1. Assignee can create a change request.
2. Reportee can create a change request.
3. Non-participant cannot create.
4. Create starts a new thread.
5. Same task can have multiple historical change requests.
6. Assignee can add message.
7. Reportee can add message.
8. Escalation is blocked for root task.
9. Escalation goes to parent task reportee.
10. Escalated reportee can read full thread history.
11. Only task reportee can resolve.
12. Resolved request cannot be escalated.
13. Attachment download is blocked for non-visible user.
14. List returns own threads and escalated threads correctly.

Verification commands:

- `npm run build`
- `npm run migration:run`
- targeted e2e or integration tests for the change-request routes

## 15. Suggested First Backend Slice

The fastest useful slice is:

1. schema
2. entities
3. create request with initial message
4. list/detail
5. add message
6. escalate
7. resolve

Defer multiple-file upload, notifications, and dedicated audit table until the core lifecycle is stable.

