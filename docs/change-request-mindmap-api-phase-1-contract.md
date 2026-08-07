# Change Request Mindmap API Phase 1 Contract

Phase 1 locks the backend query DTO for the future change-request impact-map endpoint.

## Completed Changes

1. Added `ChangeRequestImpactMapQueryDto`.

File:

- `src/tasks/dtos/change-request-impact-map-query.dto.ts`

The DTO includes subtree controls:

- `depth`
- `limit`
- `includeCompleted`
- `includeDeleted`
- `includeSuperseded`
- `collapsedMode`

The DTO includes change-request filters:

- `status`
- `impactType`
- `priority`
- `createdByUserId`
- `escalatedToUserId`
- `reviewerUserId`
- `needsMyAttention`
- `includeItems`
- `itemLimitPerTask`

2. Exported the DTO from the task DTO barrel.

File:

- `src/tasks/dtos/index.ts`

## Contract Decision

`ChangeRequestImpactMapQueryDto` is standalone instead of extending `TaskMindmapQueryDto`.

Reason:

- the impact-map endpoint should reuse mindmap subtree controls
- it should not inherit the mindmap-specific `include` query parameter
- the endpoint contract stays focused on CR overlay behavior

## Validation Notes

- `depth` accepts an integer or `all`, matching the existing mindmap behavior.
- boolean query params use the same explicit string transform behavior as `TaskMindmapQueryDto`.
- `itemLimitPerTask` is constrained to `1-25`.
- `limit` is constrained to `1-1000`, matching the current mindmap limit range.

## Phase 1 Exit Gate

Complete.

Verification:

```sh
npm run build
```

Result:

- build passed
