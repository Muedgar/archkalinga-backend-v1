# Change Request Mindmap API Phase 7 Logical Implementation Check

Phase 7 was requested as a logical implementation check only. No new unit tests were added in this phase.

## Scope

Reviewed implementation files:

- `src/tasks/tasks.controller.ts`
- `src/tasks/tasks.service.ts`
- `src/tasks/services/task-change-request-impact-map.service.ts`
- `src/tasks/services/change-request-query-scopes.ts`
- `src/tasks/dtos/change-request-impact-map-query.dto.ts`
- `src/tasks/services/task-query.service.ts`
- `src/tasks/services/task-auth.service.ts`

## Checklist

1. Authentication and permission checks

Status: Pass

- `TasksController` is guarded by `JwtAuthGuard` at the controller level.
- The endpoint uses `ProjectPermissionGuard`.
- The endpoint requires `changeRequestManagement.view`.
- `TasksService.getTaskChangeRequestImpactMap(...)` verifies `changeRequestManagement.view` when no prefetched membership is supplied.

2. Root task project mismatch

Status: Pass

- `TaskChangeRequestImpactMapService` resolves the root through `TaskQueryService.getTaskTree(...)`.
- `getTaskTree(...)` loads the root task by both `taskId` and `projectId`.
- A task from another project is not returned as the root.

3. Subtree scoping

Status: Pass

- Visible task IDs are derived only from the tree returned by `TaskQueryService`.
- The CR query is constrained by both `projectId` and `taskId IN (:...taskIds)`.
- CR rows outside the resolved subtree cannot enter the response.

4. Collapsed mode matching mindmap projection

Status: Pass

- The projection service requests `viewMeta` from the tree.
- `collapsedMode=respect` hides descendants of collapsed nodes.
- `collapsedMode=ignore` includes loaded descendants.

5. Status filter

Status: Pass

- `buildChangeRequestRowsQuery(...)` applies `changeRequest.status = :status`.
- Latest status, preview items, and summary buckets are computed after this filter.

6. Impact type filter

Status: Pass

- `buildChangeRequestRowsQuery(...)` applies `changeRequest.impactType = :impactType`.

7. Priority filter

Status: Pass

- `buildChangeRequestRowsQuery(...)` applies `changeRequest.priority = :priority`.

8. Created-by filter

Status: Pass

- `buildChangeRequestRowsQuery(...)` applies `changeRequest.createdByUserId = :createdByUserId`.

9. Reviewer filter

Status: Pass

- The CR query joins `changeRequest.reviews` as `review`.
- `reviewerUserId` applies `review.reviewerUserId = :reviewerUserId`.
- The query uses `distinct(true)` so multiple joined rows do not inflate the lightweight CR row set.

10. Escalated-to filter

Status: Pass

- `buildChangeRequestRowsQuery(...)` applies `changeRequest.escalatedToUserId = :escalatedToUserId`.

11. Needs-my-attention filter

Status: Pass

- The service reuses `applyChangeRequestNeedsMyAttentionScope(...)`.
- Required aliases are joined by the impact-map query:
  - `changeRequest`
  - `task`
  - `taskAssignee`
  - `review`
- The same attention semantics as the task-scoped CR list are used.

12. Summary buckets

Status: Pass

- Task-level summaries are built in `buildTaskSummaries(...)`.
- Subtree totals are built in `buildSummary(...)`.
- Status, impact-type, and priority buckets are merged from task summaries.
- Open statuses are:
  - `NEW`
  - `UNDER_REVIEW`
  - `ESCALATED`
  - `RETURNED_FOR_REVISION`
- Final statuses are:
  - `APPROVED`
  - `REJECTED`
  - `CANCELLED`

13. `includeItems=false`

Status: Pass

- `itemsByTaskId` is omitted unless `includeItems === true`.

14. `includeItems=true` with `itemLimitPerTask`

Status: Pass

- `buildItemsByTaskId(...)` sorts rows by `updatedAt DESC`.
- It caps preview rows per task using `itemLimitPerTask`.
- `itemLimitPerTask` is validated by DTO constraints as `1-25`.

## Observations

- `needsMyAttention=false` behaves as no attention filter. This matches the existing pattern where attention filtering is only active when the flag is explicitly `true`.
- `affectedTaskCount` counts tasks with matching CR rows, not every visible task in the subtree. This matches the impact-map purpose: only affected tasks are summarized.
- `includeDeleted` remains constrained by existing `TaskQueryService` behavior, where deleted task inclusion is only honored for admins.
- No new persistence tables or migrations are needed.

## Phase 7 Exit Gate

Complete.

Result:

- All requested logical implementation checks pass.
- No new unit tests were written in this phase.
