# Change Request Mindmap API Phase 0 Baseline

Phase 0 confirms the current backend surface before implementing the change-request impact-map endpoint.

## Baseline Findings

1. The existing subtree projection lives in `TaskQueryService`.

Relevant file:

- `src/tasks/services/task-query.service.ts`

Confirmed behavior:

- `getTaskMindmap(...)` calls `getTaskTree(...)` for the base task subtree.
- It respects `depth`, `limit`, `includeCompleted`, `includeDeleted`, and `includeSuperseded`.
- It applies mindmap collapse visibility after the tree is loaded.
- It returns `visibleTaskCount` and `hiddenByCollapseCount`.
- It already supports an include key named `requests`.

2. The current mindmap request overlay is lightweight only.

Relevant method:

- `TaskQueryService.loadRequestCountMap(...)`

Current node-level CR data:

```ts
counts: {
  openRequestCount: number;
  urgentRequestCount: number;
}
```

Current aggregate logic:

- counts only open request statuses:
  - `NEW`
  - `UNDER_REVIEW`
  - `ESCALATED`
  - `RETURNED_FOR_REVISION`
- counts urgent requests as `priority = CRITICAL`
- groups only by `taskId`

Confirmed gap:

- No status buckets.
- No impact-type buckets.
- No priority buckets except critical count.
- No latest status or latest updated timestamp.
- No `needsMyAttention` summary.
- No preview CR items by task.

3. Existing task-scoped CR list/filter behavior lives in `TaskChangeRequestsService`.

Relevant file:

- `src/tasks/services/task-change-requests.service.ts`

Confirmed behavior:

- `listTaskChangeRequests(...)` owns the current task-scoped CR query.
- It supports filters for:
  - `status`
  - `impactType`
  - `priority`
  - `createdByUserId`
  - `escalatedToUserId`
  - `reviewerUserId`
  - `documentId`
  - `hasAffectedDocuments`
  - `hasProposedTaskChanges`
  - `needsMyAttention`
- `includeSummary` builds task-level CR summary counters.
- `includeMessages` expands CR thread messages.

4. `needsMyAttention` is implemented as private query scope.

Relevant methods:

- `TaskChangeRequestsService.applyNeedsMyAttentionScope(...)`
- `TaskChangeRequestsService.countNeedsMyAttention(...)`

Current attention conditions:

- pending review assigned to the current user
- returned-for-revision request where the current user is creator, reportee, or task assignee
- escalated request where the current user is `escalatedToUserId`

Implementation implication:

- Phase 2 should extract or expose this query-scope behavior before the impact-map projection uses it, otherwise the same attention logic will be duplicated.

5. Controller permissions are already split correctly.

Relevant file:

- `src/tasks/tasks.controller.ts`

Confirmed routes:

```http
GET /projects/:projectId/tasks/:taskId/mindmap
```

Permission:

```ts
@RequireProjectPermission('taskManagement', 'view')
```

```http
GET /projects/:projectId/tasks/:taskId/change-requests
```

Permission:

```ts
@RequireProjectPermission('changeRequestManagement', 'view')
```

Implementation implication:

- The new impact-map endpoint should use `changeRequestManagement.view`.
- It should pass `req.projectMembership` through the service facade, matching the existing mindmap optimization.

6. Task service/module wiring supports another focused sub-service.

Relevant files:

- `src/tasks/tasks.service.ts`
- `src/tasks/tasks.module.ts`
- `src/tasks/services/index.ts`

Confirmed structure:

- `TasksService` is a facade over focused sub-services.
- `TasksModule` registers focused services in `SUB_SERVICES`.
- `ChangeRequest`, `ChangeRequestReview`, `ChangeRequestThread`, `ChangeRequestThreadMessage`, and `ChangeRequestMessageAttachment` are already registered with TypeORM.

Implementation implication:

- Add a new `TaskChangeRequestImpactMapService` rather than putting projection logic into `TasksService`.

7. No MVP database migration is needed.

Relevant file:

- `src/tasks/entities/change-request.entity.ts`

Fields already available for the MVP:

- `projectId`
- `taskId`
- `createdByUserId`
- `status`
- `impactType`
- `priority`
- `escalatedToUserId`
- `updatedAt` from `AppBaseEntity`
- reviews via `ChangeRequestReview`

Indexes already available:

- `idx_change_requests_project_status`
- `idx_change_requests_task_status`
- `idx_change_requests_impact_type`
- `idx_change_requests_priority`
- `idx_change_requests_created_by`
- `idx_change_requests_escalated_to`
- `idx_change_requests_resolved_by`

## Phase 0 Exit Gate

Complete.

The existing service ownership is clear:

- `TaskQueryService` provides the task subtree and mindmap visibility behavior.
- `TaskChangeRequestsService` owns the existing CR list filters and `needsMyAttention` semantics.

The MVP can proceed without schema changes.
