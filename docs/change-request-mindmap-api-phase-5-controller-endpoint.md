# Change Request Mindmap API Phase 5 Controller Endpoint

Phase 5 exposes the change-request impact-map projection through the task controller.

## Completed Changes

1. Added a response message constant.

File:

- `src/tasks/messages/success.ts`

Constant:

```ts
TASK_CHANGE_REQUEST_IMPACT_MAP_FETCHED
```

2. Added the controller endpoint.

File:

- `src/tasks/tasks.controller.ts`

Route:

```http
GET /projects/:projectId/tasks/:taskId/change-request-impact-map
```

Controller method:

```ts
getTaskChangeRequestImpactMap(...)
```

3. Added query DTO usage.

DTO:

```ts
ChangeRequestImpactMapQueryDto
```

4. Applied endpoint guards and permission.

Permission:

```ts
@RequireProjectPermission('changeRequestManagement', 'view')
```

The method passes `req.projectMembership` into `TasksService.getTaskChangeRequestImpactMap(...)` so the service can avoid a redundant permission lookup.

## Phase 5 Exit Gate

Complete.

Verification:

```sh
npm run build
```

Result:

- build passed
- controller imports resolve
- endpoint is ready for API/manual checks
