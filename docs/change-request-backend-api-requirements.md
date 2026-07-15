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
- the request has a final decision
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
- the request has a final decision
- required resolution text is missing

When resolution succeeds:

- status becomes the selected decision outcome: `APPROVED`, `REJECTED`, `RETURNED_FOR_REVISION`, or `CANCELLED`
- `resolvedByUserId` is set to the task reportee
- `resolvedAt` is set
- a resolution message is inserted in the same thread

### 2.7 Who Can Submit a Revision

A revision can be submitted by:

- the change request creator
- task assignee
- task reportee

Revision submission is only for `RETURNED_FOR_REVISION` requests. Final decisions must be reopened by the task reportee before any new review pass continues.

When revision succeeds:

- status becomes `UNDER_REVIEW`
- `resolvedByUserId` is cleared
- `resolvedAt` is cleared
- a revision message is inserted in the same thread
- a formal audit entry is recorded separately from chat

### 2.8 Who Can Reopen

Only the task reportee can reopen a change request after a final decision.

When reopening succeeds:

- status becomes `UNDER_REVIEW`
- `resolvedByUserId` is cleared
- `resolvedAt` is cleared
- a system message records the reopening reason
- a formal audit entry is recorded separately from chat

## 3. Status Model

Use an explicit workflow state model:

- `NEW`
- `UNDER_REVIEW`
- `ESCALATED`
- `APPROVED`
- `REJECTED`
- `RETURNED_FOR_REVISION`
- `CANCELLED`

Recommended enum:

```ts
export enum ChangeRequestStatus {
  NEW = 'NEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ESCALATED = 'ESCALATED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED_FOR_REVISION = 'RETURNED_FOR_REVISION',
  CANCELLED = 'CANCELLED',
}
```

Allowed transitions:

| From                    | Action          | To                                                              | Actor                                    |
| ----------------------- | --------------- | --------------------------------------------------------------- | ---------------------------------------- |
| none                    | create          | `NEW`                                                           | task assignee or task reportee           |
| `NEW`                   | start review    | `UNDER_REVIEW`                                                  | task reportee                            |
| `NEW`                   | escalate        | `ESCALATED`                                                     | task assignee or task reportee           |
| `UNDER_REVIEW`          | escalate        | `ESCALATED`                                                     | task assignee or task reportee           |
| `ESCALATED`             | escalate        | `ESCALATED`                                                     | task assignee or task reportee           |
| `NEW`                   | decide          | `APPROVED`, `REJECTED`, `RETURNED_FOR_REVISION`, or `CANCELLED` | task reportee                            |
| `UNDER_REVIEW`          | decide          | `APPROVED`, `REJECTED`, `RETURNED_FOR_REVISION`, or `CANCELLED` | task reportee                            |
| `ESCALATED`             | decide          | `APPROVED`, `REJECTED`, `RETURNED_FOR_REVISION`, or `CANCELLED` | task reportee                            |
| `RETURNED_FOR_REVISION` | submit revision | `UNDER_REVIEW`                                                  | creator, task assignee, or task reportee |
| `RETURNED_FOR_REVISION` | cancel          | `CANCELLED`                                                     | task reportee                            |
| `APPROVED`              | reopen          | `UNDER_REVIEW`                                                  | task reportee                            |
| `REJECTED`              | reopen          | `UNDER_REVIEW`                                                  | task reportee                            |
| `CANCELLED`             | reopen          | `UNDER_REVIEW`                                                  | task reportee                            |

`APPROVED`, `REJECTED`, and `CANCELLED` are final decision states. `RETURNED_FOR_REVISION` is not final; it is the handoff state that waits for a revised submission.

Do not allow messages to change status by themselves. Status changes should happen through explicit create, review, escalate, revision, reopen, and decision actions.

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
- `impact_type` enum nullable: `SCOPE`, `COST`, `SCHEDULE`, `QUALITY`, `SAFETY`, `DOCUMENTATION`, `OTHER`
- `priority` enum nullable: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `reason_category` varchar(100) nullable
- `cost_impact_amount` numeric(14,2) nullable
- `schedule_impact_days` integer nullable
- `requested_due_date` date nullable
- `proposed_task_changes` jsonb nullable, structured requested task-field changes such as title, dates, status, priority, assignee, or schedule fields
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

### 4.2 `change_request_documents`

Join table linking a change request to task documents affected by the requested change.

Recommended columns:

- `change_request_id` uuid not null, FK `change_requests(id)` on delete cascade
- `document_id` uuid not null, FK `task_documents(id)` on delete cascade

Constraints and indexes:

- primary key on `(change_request_id, document_id)`
- `idx_change_request_documents_document` on `(document_id)`

Business rule:

- affected documents must belong to the same task as the change request
- document links provide traceability only; approving a change request does not automatically create, update, or replace task documents

### 4.3 `change_request_threads`

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

### 4.4 `change_request_thread_messages`

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

### 4.5 `change_request_message_attachments`

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

### 4.6 `change_request_reviews`

Structured review assignments for cost, technical, schedule, client, or other approval-chain checks.

Recommended columns:

- `pkid` serial primary key
- `id` uuid unique default `uuid_generate_v4()`
- `version` integer
- `change_request_id` uuid not null, FK `change_requests(id)` on delete cascade
- `reviewer_user_id` uuid not null, FK `users(id)` on delete restrict
- `assigned_by_user_id` uuid not null, FK `users(id)` on delete restrict
- `role` varchar(100) nullable
- `status` enum not null default `PENDING`: `PENDING`, `APPROVED`, `REJECTED`, `RETURNED_FOR_REVISION`
- `notes` text nullable
- `decision_notes` text nullable
- `decided_at` timestamptz nullable
- `created_at` timestamptz

Indexes:

- `idx_change_request_reviews_change_request` on `(change_request_id)`
- `idx_change_request_reviews_reviewer_status` on `(reviewer_user_id, status)`
- `idx_change_request_reviews_assigned_by` on `(assigned_by_user_id)`

### 4.7 `change_request_audit_entries`

Formal lifecycle and decision ledger, stored separately from chat thread messages.

Recommended columns:

- `pkid` serial primary key
- `id` uuid unique default `uuid_generate_v4()`
- `version` integer
- `change_request_id` uuid not null, FK `change_requests(id)` on delete cascade
- `actor_user_id` uuid not null, FK `users(id)` on delete restrict
- `action` enum not null: `CREATED`, `REVIEW_ASSIGNED`, `REVIEW_DECIDED`, `ESCALATED`, `DECISION_RECORDED`, `REVISION_SUBMITTED`, `REOPENED`
- `from_status` change request status nullable
- `to_status` change request status nullable
- `review_id` uuid nullable, FK `change_request_reviews(id)` on delete set null
- `message_id` uuid nullable, FK `change_request_thread_messages(id)` on delete set null
- `metadata` jsonb nullable
- `created_at` timestamptz

Indexes:

- `idx_change_request_audit_entries_change_request` on `(change_request_id)`
- `idx_change_request_audit_entries_actor` on `(actor_user_id)`
- `idx_change_request_audit_entries_action` on `(action)`

Audit entries are required for lifecycle and decision events. Chat messages remain useful for conversation, but formal decision history must be reconstructable from this table without parsing message text.

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
- `impactType`: optional enum, primary impact area
- `priority`: optional enum
- `reasonCategory`: optional string, max 100
- `costImpactAmount`: optional number
- `scheduleImpactDays`: optional integer
- `requestedDueDate`: optional ISO date
- `affectedDocumentIds`: optional uuid array; documents must belong to the same task
- `proposedTaskChanges`: optional JSON object describing requested task-field changes
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

### 6.5 Assign Review

`CreateChangeRequestReviewDto`

- `reviewerUserId`: required uuid
- `role`: optional string, max 100
- `notes`: optional string

### 6.6 Record Review Decision

`DecideChangeRequestReviewDto`

- `decision`: required enum: `APPROVED`, `REJECTED`, `RETURNED_FOR_REVISION`
- `decisionNotes`: optional string

### 6.7 Submit Revision

`SubmitChangeRequestRevisionDto`

- `message`: required unless an attachment is provided
- `attachmentNotes`: optional string

### 6.8 Reopen

`ReopenChangeRequestDto`

- `reason`: required string

### 6.9 List Filters

- `status`
- `impactType`
- `priority`
- `taskId`
- `createdByUserId`
- `escalatedToUserId`
- `reviewerUserId`
- `documentId`
- `hasAffectedDocuments`
- `hasProposedTaskChanges`
- `needsMyAttention`
- `includeSummary`
- `includeMessages`

`ChangeRequestFiltersDto`

- `page`
- `limit`
- `status`
- `impactType`
- `priority`
- `taskId`
- `createdByUserId`
- `escalatedToUserId`
- `reviewerUserId`
- `documentId`
- `hasAffectedDocuments`
- `hasProposedTaskChanges`
- `needsMyAttention`
- `search`
- `includeSummary`
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
- revise: creator, task assignee, or task reportee
- reopen: task reportee only
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

Dashboard support:

- `includeSummary=true` returns summary counters computed from the same visible, filtered result set before pagination
- summary includes total, open/final counts, pending review counts, current-user attention count, document-linked count, proposed-task-change count, and buckets by status, impact type, and priority
- `needsMyAttention=true` filters to pending reviews assigned to the current user, returned-for-revision requests the current user can revise, and escalated requests assigned to the current user

### 9.2 Get Change Request Detail

`GET /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId`

Permission:

- `changeRequestManagement.view`

Returns:

- change request
- `affectedDocumentIds`, `affectedDocuments`, and `proposedTaskChanges`
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
- every `affectedDocumentIds` entry must reference a document on the same task
- `proposedTaskChanges` is traceability metadata; it does not automatically mutate the task

Behavior:

- create `change_requests`
- store `proposedTaskChanges`
- link affected task documents in `change_request_documents`
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

### 9.6 Assign Review

`POST /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/reviews`

Permission:

- `changeRequestManagement.update`

Business rule:

- actor must have access to the thread
- request must not be closed
- reviewer must exist

Behavior:

- create `change_request_reviews` row with `PENDING` status
- move `NEW` request to `UNDER_REVIEW`
- insert `SYSTEM` message in the thread
- notify reviewer
- return full change request detail

### 9.7 Record Review Decision

`POST /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/reviews/:reviewId/decision`

Permission:

- `changeRequestManagement.view`

Business rule:

- only the assigned reviewer can decide their review
- request must not be closed
- review must still be `PENDING`

Behavior:

- set review status to `APPROVED`, `REJECTED`, or `RETURNED_FOR_REVISION`
- set `decisionNotes`
- set `decidedAt`
- insert `SYSTEM` message in the thread
- notify participants
- return full change request detail

### 9.8 Submit Revision

`POST /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/revision`

Consumes:

- `multipart/form-data`

Permission:

- `changeRequestManagement.update`

Business rule:

- actor must be the creator, task assignee, or task reportee
- current status must be `RETURNED_FOR_REVISION`

Behavior:

- set status to `UNDER_REVIEW`
- clear `resolvedByUserId`
- clear `resolvedAt`
- insert `MESSAGE` in the thread
- write `REVISION_SUBMITTED` audit entry
- notify participants
- return full change request detail

### 9.9 Reopen

`POST /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/reopen`

Permission:

- `changeRequestManagement.update`

Business rule:

- actor must be the task reportee
- current status must allow transition back to `UNDER_REVIEW`

Behavior:

- set status to `UNDER_REVIEW`
- clear `resolvedByUserId`
- clear `resolvedAt`
- insert `SYSTEM` message in the thread with the reopening reason
- write `REOPENED` audit entry
- notify participants
- return full change request detail

### 9.10 Resolve

`POST /projects/:projectId/tasks/:taskId/change-requests/:changeRequestId/resolve`

Consumes:

- `multipart/form-data`

Permission:

- `changeRequestManagement.update`

Business rule:

- actor must be the task reportee
- request must not already have a final decision

Behavior:

- set status to the selected decision outcome
- set `resolvedByUserId`
- set `resolvedAt`
- insert `RESOLUTION` message
- return full change request detail

### 9.11 Attachment Download URL

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
- `TASK_CHANGE_REQUEST_RESOLVED` for the decision endpoint
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
- `INVALID_CHANGE_REQUEST_CLOSED`
- `INVALID_CHANGE_REQUEST_STATUS_TRANSITION`
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

- full lifecycle works from `NEW` or `UNDER_REVIEW` to `ESCALATED` and a final decision outcome

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
