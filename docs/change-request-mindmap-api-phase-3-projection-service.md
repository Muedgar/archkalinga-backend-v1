# Change Request Mindmap API Phase 3 Projection Service

Phase 3 builds the projection service for the future change-request impact-map endpoint.

## Completed Changes

1. Added `TaskChangeRequestImpactMapService`.

File:

- `src/tasks/services/task-change-request-impact-map.service.ts`

Public method:

```ts
getTaskChangeRequestImpactMap(
  projectId: string,
  taskId: string,
  query: ChangeRequestImpactMapQueryDto,
  requestUser: RequestUser,
  prefetchedMembership?: ProjectMembership | null,
)
```

2. The service resolves the task subtree through `TaskQueryService.getTaskTree(...)`.

The subtree query requests `viewMeta` so the service can apply the same mindmap collapse semantics as the existing mindmap projection.

3. The service computes visible task IDs.

Supported behavior:

- `collapsedMode = respect` hides descendants of collapsed nodes
- `collapsedMode = ignore` includes the loaded tree descendants
- task IDs are scoped to the tree returned by `TaskQueryService`

4. The service loads lightweight distinct CR rows.

Selected fields:

- `id`
- `taskId`
- `title`
- `status`
- `impactType`
- `priority`
- `createdByUserId`
- `escalatedToUserId`
- `updatedAt`

The query supports filters for:

- `status`
- `impactType`
- `priority`
- `createdByUserId`
- `escalatedToUserId`
- `reviewerUserId`
- `needsMyAttention`

5. The service reuses the shared Phase 2 attention scope.

Helper:

```ts
applyChangeRequestNeedsMyAttentionScope(...)
```

6. The service aggregates task-level summaries.

Per affected task:

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

7. The service aggregates subtree-level summary totals.

Summary:

- `affectedTaskCount`
- `total`
- `open`
- `final`
- `escalated`
- `needsMyAttention`
- `critical`
- `byStatus`
- `byImpactType`
- `byPriority`

8. The service optionally returns preview items.

When `includeItems=true`, it returns `itemsByTaskId` with lightweight CR cards capped by `itemLimitPerTask`.

## Implementation Notes

The service intentionally queries distinct lightweight CR rows and aggregates in TypeScript. This avoids inflated counts caused by review and assignee joins.

The service is not registered in `TasksModule` yet. That is Phase 4.

## Phase 3 Exit Gate

Complete.

Verification:

```sh
npm run build
```

Result:

- build passed
- the projection service compiles
- no endpoint or module wiring has been added yet
