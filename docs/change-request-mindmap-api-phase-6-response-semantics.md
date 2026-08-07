# Change Request Mindmap API Phase 6 Response Semantics

Phase 6 verifies that the projection service response can drive the frontend change-request mindmap overlay.

## Completed Changes

1. Added focused service tests.

File:

- `src/tasks/services/task-change-request-impact-map.service.spec.ts`

Coverage added:

- empty visible subtree response with no CR rows
- open/final status classification
- status, impact-type, and priority buckets
- `needsMyAttention` counts using the shared attention scope
- escalated and critical counters
- high intensity from escalated/critical CRs
- latest status and latest update timestamp after filters are applied
- `includeItems=true` preview item cap
- collapsed mindmap descendants excluded from visible task IDs

2. Added Jest path alias support.

File:

- `package.json`

Added:

```json
"moduleNameMapper": {
  "^src/(.*)$": "<rootDir>/$1"
}
```

This lets service specs import app code that uses `src/...` path aliases.

## Verified Semantics

Status classification:

- open:
  - `NEW`
  - `UNDER_REVIEW`
  - `ESCALATED`
  - `RETURNED_FOR_REVISION`
- final:
  - `APPROVED`
  - `REJECTED`
  - `CANCELLED`

Intensity:

- `none`: no CRs
- `low`: one non-critical, non-escalated CR
- `medium`: two to four CRs
- `high`: five or more CRs, any `CRITICAL`, or any `ESCALATED`

Latest status:

- computed from the latest updated CR after query filters are applied

Collapsed visibility:

- descendants of collapsed mindmap nodes are excluded when `collapsedMode=respect`

## Phase 6 Exit Gate

Complete.

Verification:

```sh
npx jest task-change-request-impact-map.service.spec.ts --runInBand
npm test -- --runInBand
npm run build
```

Result:

- focused semantic spec passed
- full unit test suite passed
- build passed
