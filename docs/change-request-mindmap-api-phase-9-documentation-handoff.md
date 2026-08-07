# Change Request Mindmap API Phase 9 Documentation Handoff

Phase 9 documents the frontend integration contract for the change-request mindmap overlay endpoint.

## Completed Changes

1. Updated the frontend API reference.

File:

- `FRONTEND_API_REFERENCE.md`

Added `changeRequestManagement.*` to the project permission summary.

2. Added the Change Request Mindmap Overlay section.

Endpoint:

```http
GET /projects/:projectId/tasks/:taskId/change-request-impact-map
```

Documented:

- required permission
- recommended frontend flow
- query params
- response shape
- rendering notes
- relationship to the existing task-scoped CR list/detail APIs

## Frontend Integration Summary

1. Load the normal mindmap first.
2. Fetch the impact map only when Change Requests mode is enabled.
3. Merge `data.taskSummaries[node.id]` onto existing mindmap nodes.
4. Use `summary` and task summaries for badges, filters, and heat styling.
5. Use the existing task-scoped CR APIs for full messages, attachments, and workflow detail.

## Phase 9 Exit Gate

Complete.

Result:

- Frontend has a stable endpoint contract and integration sequence.
- Full CR messages and attachments are explicitly documented as staying on existing CR APIs.
