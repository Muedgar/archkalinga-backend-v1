# Change Request Mindmap API Execution Order

This execution order turns `docs/change-request-mindmap-api-plan.md` into a build sequence for the backend.

## Phase 0: Confirm Baseline

1. Read the current task projection and change-request code paths:
   - `src/tasks/services/task-query.service.ts`
   - `src/tasks/services/task-change-requests.service.ts`
   - `src/tasks/tasks.service.ts`
   - `src/tasks/tasks.controller.ts`
   - `src/tasks/tasks.module.ts`
   - `src/tasks/dtos/task-mindmap-query.dto.ts`
   - `src/tasks/dtos/change-request-filters.dto.ts`

2. Confirm the existing mindmap response only exposes:
   - `openRequestCount`
   - `urgentRequestCount`

3. Confirm no database migration is needed for the MVP because the required fields already exist on `change_requests`.

Exit gate:

- You can explain which existing service provides the subtree and which existing service owns CR filtering semantics.

## Phase 1: Lock The API Contract

1. Create `src/tasks/dtos/change-request-impact-map-query.dto.ts`.

2. Include subtree query options:
   - `depth`
   - `limit`
   - `includeCompleted`
   - `includeDeleted`
   - `includeSuperseded`
   - `collapsedMode`

3. Include CR filter options:
   - `status`
   - `impactType`
   - `priority`
   - `createdByUserId`
   - `escalatedToUserId`
   - `reviewerUserId`
   - `needsMyAttention`
   - `includeItems`
   - `itemLimitPerTask`

4. Export the DTO from `src/tasks/dtos/index.ts`.

Exit gate:

- The DTO compiles and Swagger can infer all public query parameters.

## Phase 2: Extract Shared CR Query Scope

1. Inspect `TaskChangeRequestsService.applyNeedsMyAttentionScope(...)`.

2. If the new impact-map service needs the same behavior, extract the scope into a shared helper in the CR service layer. Keep behavior identical to the existing task CR list endpoint.

3. Avoid changing public behavior of:
   - `GET /projects/:projectId/tasks/:taskId/change-requests`

Exit gate:

- Existing change-request list filtering still behaves the same.
- The impact-map service can reuse `needsMyAttention` logic without copy-paste drift.

## Phase 3: Build The Projection Service

1. Create `src/tasks/services/task-change-request-impact-map.service.ts`.

2. Inject:
   - `ChangeRequest` repository
   - `TaskQueryService`
   - any shared CR query helper needed for `needsMyAttention`

3. Add a public method:

```ts
getTaskChangeRequestImpactMap(
  projectId: string,
  taskId: string,
  query: ChangeRequestImpactMapQueryDto,
  requestUser: RequestUser,
  prefetchedMembership?: ProjectMembership | null,
)
```

4. Use `TaskQueryService.getTaskTree(...)` to resolve the same task subtree as the mindmap.

5. Flatten the returned tree into visible task IDs. Respect:
   - depth
   - limit
   - completed/deleted/superseded flags
   - collapsed mode

6. Query `change_requests` once for aggregate counts grouped by:
   - `taskId`
   - `status`
   - `impactType`
   - `priority`

7. Apply optional CR filters before aggregation.

8. Compute task-level summaries:
   - `total`
   - `open`
   - `final`
   - `escalated`
   - `critical`
   - `needsMyAttention`
   - `latestStatus`
   - `latestUpdatedAt`
   - `intensity`
   - `byStatus`
   - `byImpactType`
   - `byPriority`

9. Compute project/subtree summary totals from task summaries.

10. If `includeItems=true`, fetch lightweight CR preview rows and group them under `itemsByTaskId`, capped by `itemLimitPerTask`.

Exit gate:

- One request can produce all CR overlay summaries for the visible subtree without N+1 task-level CR calls.

## Phase 4: Wire The Service

1. Export the new service from `src/tasks/services/index.ts`.

2. Register it in `SUB_SERVICES` inside `src/tasks/tasks.module.ts`.

3. Inject it into `src/tasks/tasks.service.ts`.

4. Add a facade method on `TasksService` that delegates to the projection service.

Exit gate:

- The Nest dependency graph resolves cleanly.

## Phase 5: Add Controller Endpoint

1. Add a success message in `src/tasks/messages/success.ts` or the existing task message export path:

```ts
TASK_CHANGE_REQUEST_IMPACT_MAP_FETCHED
```

2. Add the controller route in `src/tasks/tasks.controller.ts`:

```ts
@Get('tasks/:taskId/change-request-impact-map')
@UseGuards(ProjectPermissionGuard)
@RequireProjectPermission('changeRequestManagement', 'view')
getTaskChangeRequestImpactMap(...)
```

3. Pass `req.projectMembership` into the service facade to avoid redundant membership lookups where possible.

Exit gate:

- Authenticated users with `changeRequestManagement.view` can call the endpoint.
- Users without that permission are rejected.

## Phase 6: Verify Response Semantics

1. Test an empty subtree:
   - `affectedTaskCount = 0`
   - all counters are `0`
   - `taskSummaries = {}`
   - `itemsByTaskId` omitted or empty based on `includeItems`

2. Test mixed statuses:
   - `NEW`, `UNDER_REVIEW`, `ESCALATED`, and `RETURNED_FOR_REVISION` count as `open`
   - `APPROVED`, `REJECTED`, and `CANCELLED` count as `final`

3. Test intensity:
   - `none`: no CRs
   - `low`: one non-critical, non-escalated CR
   - `medium`: two to four CRs
   - `high`: five or more CRs, any `CRITICAL`, or any `ESCALATED`

4. Test `latestStatus` comes from the latest updated CR for each task after filters are applied.

Exit gate:

- Response data can directly drive badges, heat, and CR-mode filters in the frontend.

## Phase 7: Automated Tests

Add focused tests for:

1. Authentication and permission checks.
2. Root task project mismatch.
3. Subtree scoping.
4. Collapsed mode matching the mindmap projection.
5. Status filter.
6. Impact type filter.
7. Priority filter.
8. Created-by filter.
9. Reviewer filter.
10. Escalated-to filter.
11. Needs-my-attention filter.
12. Summary buckets.
13. `includeItems=false`.
14. `includeItems=true` with `itemLimitPerTask`.

Exit gate:

- The new tests pass.
- Existing task and change-request tests still pass.

## Phase 8: Manual API Check

Run a local server and verify these calls:

```http
GET /projects/:projectId/tasks/:taskId/change-request-impact-map
GET /projects/:projectId/tasks/:taskId/change-request-impact-map?status=ESCALATED
GET /projects/:projectId/tasks/:taskId/change-request-impact-map?needsMyAttention=true
GET /projects/:projectId/tasks/:taskId/change-request-impact-map?includeItems=true&itemLimitPerTask=2
```

Check:

- response shape matches the plan
- filters change totals as expected
- no full thread messages are returned
- existing drill-down endpoint still provides details

Exit gate:

- The endpoint is ready for frontend integration.

## Phase 9: Documentation Handoff

1. Update `FRONTEND_API_REFERENCE.md` with the new endpoint.

2. Add a short frontend usage note:
   - load normal mindmap first
   - fetch impact map only when CR mode is enabled
   - merge `data.taskSummaries[node.id]` onto existing nodes
   - call task-scoped CR list endpoint when opening a node

3. Mention that full messages and attachments stay on existing CR detail/list APIs.

Exit gate:

- Frontend has a stable endpoint contract and integration sequence.

## Phase 10: Optional Phase 2

Only after the standalone impact-map endpoint is accepted:

1. Add a `requestImpact` include to `GET /projects/:projectId/tasks/:taskId/mindmap`.

2. Reuse the impact-map projection logic to attach summaries directly to mindmap nodes.

3. Keep this backward compatible and disabled unless requested by `include=requestImpact`.

Exit gate:

- Consumers can choose either the separate overlay endpoint or a single enriched mindmap payload.
