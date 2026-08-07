# Change Request Mindmap API Phase 4 Service Wiring

Phase 4 wires the change-request impact-map projection service into the task module and public task service facade.

## Completed Changes

1. Exported the projection service from the task service barrel.

File:

- `src/tasks/services/index.ts`

Export:

```ts
TaskChangeRequestImpactMapService
```

2. Registered the projection service in `TasksModule`.

File:

- `src/tasks/tasks.module.ts`

The service is now included in `SUB_SERVICES`, so Nest can resolve it and inject its dependencies.

3. Added the projection service to `TasksService`.

File:

- `src/tasks/tasks.service.ts`

Injected:

```ts
private readonly changeRequestImpactMapSvc: TaskChangeRequestImpactMapService
```

Added facade method:

```ts
getTaskChangeRequestImpactMap(
  projectId: string,
  taskId: string,
  query: ChangeRequestImpactMapQueryDto,
  requestUser: RequestUser,
  prefetchedMembership?: ProjectMembership | null,
)
```

## Permission Behavior

If `prefetchedMembership` is provided, the method delegates directly to the projection service.

If it is not provided, the method verifies:

```ts
changeRequestManagement.view
```

Then it passes the verified membership into the projection service. This keeps the future controller path efficient while still making the facade safe for internal callers.

## Phase 4 Exit Gate

Complete.

Verification:

```sh
npm run build
```

Result:

- build passed
- Nest dependency graph resolves
- the service is ready for the controller endpoint in Phase 5
