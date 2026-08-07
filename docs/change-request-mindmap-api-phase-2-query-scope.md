# Change Request Mindmap API Phase 2 Query Scope

Phase 2 extracts the shared change-request `needsMyAttention` query behavior so the future impact-map projection can reuse the same semantics as the existing task-scoped CR list endpoint.

## Completed Changes

1. Added a shared query-scope helper.

File:

- `src/tasks/services/change-request-query-scopes.ts`

Export:

```ts
applyChangeRequestNeedsMyAttentionScope(...)
```

Default query aliases:

- `changeRequest`
- `review`
- `task`
- `taskAssignee`

The helper also accepts alias overrides for future aggregate queries that may use different join aliases.

2. Updated the existing CR list service to use the helper.

File:

- `src/tasks/services/task-change-requests.service.ts`

Replaced the private `applyNeedsMyAttentionScope(...)` method with calls to:

```ts
applyChangeRequestNeedsMyAttentionScope(qb, userId)
```

The current behavior is preserved:

- pending review assigned to the current user
- returned-for-revision request where the current user is creator, reportee, or task assignee
- escalated request where the current user is `escalatedToUserId`

3. Exported the helper from the task service barrel.

File:

- `src/tasks/services/index.ts`

## Implementation Notes

The helper assumes the caller has already joined the aliases used by the attention scope:

```ts
.leftJoinAndSelect('changeRequest.task', 'task')
.leftJoin('task.assignees', 'taskAssignee')
.leftJoinAndSelect('changeRequest.reviews', 'review')
```

The future impact-map service should either use those aliases or pass explicit alias overrides.

## Phase 2 Exit Gate

Complete.

Verification:

```sh
npm run build
```

Result:

- build passed
- existing task-scoped CR list code still uses the same attention conditions
