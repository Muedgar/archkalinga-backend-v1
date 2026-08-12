# Task Status and Progress Backend Implementation Plan

## Source Requirement

Frontend requirement document:

`/Users/mutanganaedgar/Downloads/Projects/archkalinga-frontend-v1/docs/task-status-progress-backend-api-requirements.md`

The requested product change reverses the current authority model:

- `Task.progress` becomes a backend-owned task field.
- Checklist completion no longer derives or mutates task progress.
- Moving a task or subtask into a configured Done status is the authoritative completion workflow.
- Done transitions can synchronize checklist items and descendant tasks according to explicit project status policy.

## Current Backend Baseline

The backend already has useful foundations:

- Tasks already store `progress`, `completed`, `parentTaskId`, `statusId`, and checklist relations in `src/tasks/entities/task.entity.ts`.
- Checklist items already store `completed`, `completedAt`, and `completedByUserId` in `src/tasks/entities/task-checklist-item.entity.ts`.
- Project statuses exist in `src/tasks/project-config/project-status.entity.ts` and are exposed through project config services.
- Drag/drop already routes through `PATCH /projects/:projectId/tasks/:taskId/move`.
- Recursive task structure already exists through `parentTaskId`.

The backend also has legacy behavior that must be removed or re-scoped:

- `TaskCrudService.createTask` and `TaskCrudService.updateTask` reject supplied `progress` with the old checklist-derived message.
- `TaskProgressService.recalculateProjectTaskProgress` overwrites stored `Task.progress` from checklist ratios.
- Checklist add/update/delete and task CRUD call `recalculateProjectTaskProgress`, causing checklist mutations to affect task progress.
- Status semantics are currently limited to `category`, `isDefault`, `isTerminal`, and `isActive`.
- `Task.completed` is currently tied to `isTerminal`, not explicit `isDone`.

## Phase 1: Schema and Status Semantics

### Add status semantic fields

Update `ProjectStatus`:

- Expand `StatusCategory` to `not_started`, `active`, `done`, `cancelled`, `blocked`.
- Add `isDone: boolean`, default `false`.
- Add `completionPolicy: CompletionPolicy`, default `none`.

Add enum:

```ts
export enum CompletionPolicy {
  NONE = 'none',
  COMPLETE_TASK_ONLY = 'complete_task_only',
  COMPLETE_OPEN_WORK_ITEMS = 'complete_open_work_items',
  REQUIRE_ALL_WORK_ITEMS_DONE = 'require_all_work_items_done',
}
```

Migration:

- Add columns to `project_statuses`.
- Backfill existing statuses:
  - `key = 'done'` or old `category = 'done'`: `isDone = true`, `isTerminal = true`, `category = 'done'`, `completionPolicy = 'complete_open_work_items'`.
  - Existing non-Done statuses map to `not_started` for `todo`, `active` for `in_progress`/review, `blocked` for `blocked`, and `completionPolicy = 'none'`.
- Add a partial unique index if product chooses exactly one active Done status per project:
  - unique on `project_id` where `isDone = true and isActive = true`.
  - If multiple Done statuses are allowed, skip this and enforce only "at least one active Done".

### Update config APIs

Files:

- `src/projects/dtos/project-config.dto.ts`
- `src/projects/project-config.service.ts`
- `src/projects/serializers/project-config.serializer.ts`
- `src/tasks/project-config/project-status.entity.ts`

Work:

- Add DTO validation for `category`, `isDone`, `completionPolicy`, and `isTerminal`.
- Serialize the new fields in `ProjectStatusSerializer`.
- Seed Done status with `isDone = true` and `completionPolicy = complete_open_work_items`.
- Validate status create/update so every project retains at least one active `isDone = true` status.
- Keep `isTerminal` separate from `isDone`; Cancelled can be terminal without completed work semantics.

## Phase 2: Completion Transition Service

Create a dedicated service, likely:

`src/tasks/services/task-completion-transition.service.ts`

Responsibilities:

- Centralize status transition semantics for `/move`, direct task update, and `/complete`.
- Load and validate target status within the same project.
- Apply WIP limit checks for target status.
- Detect transition direction:
  - non-Done to Done
  - Done to non-Done
  - non-Done to non-Done
  - Done to Done
- Apply completion policy in one transaction.
- Return an effect payload:
  - `checklistItemsCompleted`
  - `descendantTasksCompleted`
  - `rollupsRecalculated`
  - `changedTaskIds`
  - `warnings`

Recommended public method:

```ts
applyTransition(tx, {
  projectId,
  task,
  targetStatus,
  actorUser,
  completionMode,
  progress,
  reason,
}): Promise<TaskTransitionResult>
```

Completion rules:

- Entering `isDone = true`:
  - `task.completed = true`
  - `task.completedAt = now`
  - `task.completedByUserId = actorUser.id`
  - `task.progress = 100`
- Leaving `isDone = true`:
  - `task.completed = false`
  - clear `completedAt` and `completedByUserId`
  - keep `progress = 100` unless the request explicitly provides `progress`
- Non-Done transition:
  - accept explicit `progress` when supplied
  - do not infer progress from checklist

Important schema gap:

- `Task` currently lacks `completedAt` and `completedByUserId`. Add these columns in the same migration or a follow-up migration.

## Phase 3: Completion Policies

Implement policy behavior in the transition service.

### `none`

- Update status/order only.
- Apply explicit progress if supplied and valid.
- Do not mutate checklist or descendants.

### `complete_task_only`

- Mark task complete and set progress to `100`.
- Do not mutate checklist or descendants.

### `complete_open_work_items`

- Mark task complete and set progress to `100`.
- Mark all incomplete checklist items on the task complete with `completedAt` and `completedByUserId`.
- Mark descendant tasks complete according to a backend-defined traversal policy.
- Recommended first implementation: recursive all active descendants under the same project, excluding deleted tasks.
- For each completed descendant:
  - move it to the target Done status unless it already has an `isDone` status
  - set `completed = true`, `completedAt`, `completedByUserId`, `progress = 100`
- Return every changed task id.

### `require_all_work_items_done`

- Before changing status, query incomplete checklist items and incomplete descendants.
- If any exist, throw `409 Conflict` with:
  - `code = TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS`
  - `details.openChecklistItemIds`
  - `details.openChildTaskIds`

### Completion mode override

Extend `MoveTaskDto` and add complete endpoint DTOs with:

- `completionMode`
- `progress`
- `reason`

Map modes to policy behavior:

- `apply_status_policy`: use `ProjectStatus.completionPolicy`.
- `task_only`: force `complete_task_only`.
- `task_and_checklist`: complete task and task checklist, not descendants.
- `task_checklist_and_descendants`: complete task, checklist, and descendants.
- `validate_only`: enforce requirements without mutating work items.

## Phase 4: Task CRUD and Move Endpoint

### Create task

File:

- `src/tasks/services/task-crud.service.ts`

Changes:

- Stop rejecting `dto.progress`.
- Default `progress` to `0` when omitted.
- Validate `progress` via DTO as already defined.
- Set `completed` from `status.isDone`, not `status.isTerminal`.
- If creating directly into Done, run the completion transition path so `progress = 100`, completion fields are set, and initial checklist items are completed if policy requires it.

### Update task

Changes:

- Stop rejecting `dto.progress`.
- If `statusId` changes, delegate completion semantics to the new transition service.
- If only `progress` changes, update `Task.progress` directly and do not mutate checklist/status.
- Decide direct `completed=true` behavior:
  - Recommended: reject direct `completed` mutation unless/until `completed` exists in `UpdateTaskDto`.
  - If later accepted, translate to the single active Done status only when unambiguous.

### Move task

Changes:

- Extend `MoveTaskDto` with `completionMode`, `progress`, and `reason`.
- Preserve current rank/reparent behavior.
- When `statusId` changes, delegate status/completion changes to the transition service inside the same transaction as rank updates.
- Return the new transition response shape:

```json
{
  "task": {},
  "effects": {},
  "changedTaskIds": [],
  "warnings": []
}
```

Compatibility note:

- The current controller returns a plain `TaskSerializer`. Coordinate frontend cutover or temporarily include the serialized task under both the legacy response and new `task` key only if consumers need a bridge.

## Phase 5: New Endpoints

### `POST /projects/:projectId/tasks/:taskId/complete`

Add controller and service methods:

- Uses the single active Done status if `statusId` is omitted.
- Applies the same transition service.
- Idempotent: if task is already completed in Done, return success with zero new effects.
- Requires `taskManagement.update`.

### `PATCH /projects/:projectId/tasks/:taskId/progress`

Add DTO:

- `progress: number` required, `0..100`
- `source?: string`
- `note?: string`

Behavior:

- Update only `Task.progress`.
- Do not mutate checklist.
- Do not mutate status in the first implementation.
- Return task summary and audit metadata.

## Phase 6: Checklist Mutation Responses

Files:

- `src/tasks/services/task-checklist.service.ts`
- `src/tasks/tasks.service.ts`
- `src/tasks/tasks.controller.ts`
- `src/tasks/serializers/task.serializer.ts`

Changes:

- Remove `progressSvc.recalculateProjectTaskProgress` calls from checklist add/update/delete.
- Keep `completedAt` and `completedByUserId` behavior on toggle.
- Add a checklist mutation response serializer:

```ts
{
  item: TaskChecklistItemDetailSerializer;
  task: {
    id: string;
    progress: number;
    completed: boolean;
    checklistSummary: { total: number; completed: number };
  };
}
```

- Checklist toggle must not alter `task.statusId`.
- Checklist toggle must not alter `task.progress`.

## Phase 7: Read Model Updates

Files:

- `src/tasks/serializers/task.serializer.ts`
- `src/tasks/serializers/task-list-item.serializer.ts`
- `src/tasks/services/task-query.service.ts`
- `src/tasks/services/task-auth.service.ts`
- dashboard/tree/mindmap/gantt serializers that expose progress

Required fields:

- `status.isDone`
- `status.completionPolicy`
- `progress`
- `rollupProgress`
- `completed`
- `completedAt`
- `completedByUserId`
- `checklistSummary`

Implementation notes:

- Keep stored `progress` as task-owned manual progress.
- Rename or re-scope existing `TaskProgressService.calculateTaskProgress` to compute `rollupProgress` only.
- Never save rollup progress back to `tasks.progress`.
- For list endpoints, compute checklist summary efficiently using aggregate queries grouped by `taskId`.
- For single task and tree endpoints, derive summary from loaded checklist items.

## Phase 8: Audit and Events

File:

- `src/tasks/entities/task-activity-log.entity.ts`

Add action types:

- `TASK_PROGRESS_CHANGED = 'task:progress_changed'`
- `TASK_COMPLETED = 'task:completed'`
- `TASK_REOPENED = 'task:reopened'`
- `TASK_CHECKLIST_ITEM_COMPLETED = 'checklist:item_completed'`
- `TASK_CHECKLIST_ITEM_REOPENED = 'checklist:item_reopened'`
- `TASK_DESCENDANTS_COMPLETED_BY_PARENT_DONE = 'task:descendants_completed_by_parent_done'`

Log metadata:

- actor user id
- previous status id
- next status id
- previous progress
- next progress
- checklist item ids completed by policy
- descendant task ids completed by policy
- completion mode
- reason

Also update outbox/sync-event payloads if frontend sync consumers depend on task activity streams.

## Phase 9: Tests

Add focused service/controller tests for:

- Creating a task with omitted progress defaults to `0`.
- Creating/updating a task with invalid progress fails DTO validation.
- Checklist toggle changes checklist state but not task progress or status.
- Moving to Done sets `completed = true`, completion fields, and `progress = 100`.
- Moving out of Done sets `completed = false` and preserves `progress = 100` unless explicit progress is supplied.
- `complete_open_work_items` completes open checklist items and descendants in one transaction.
- `require_all_work_items_done` returns `409` with open checklist and child task ids.
- `/complete` is idempotent.
- `/progress` emits progress audit and does not mutate checklist/status.
- Project status config cannot remove the last active Done status.

Regression targets:

- `TaskProgressService` no longer persists checklist-derived progress.
- Kanban move/reorder still preserves rank and reparenting behavior.
- Task tree/mindmap/gantt responses still expose rollup progress without overwriting `Task.progress`.

## Suggested Implementation Order

1. Add migrations/entities/DTOs/serializers for status semantics and task completion fields.
2. Update status seeding and config validation.
3. Add the transition service and unit-test policy behavior in isolation.
4. Wire transition service into `moveTask`.
5. Wire transition service into `updateTask`.
6. Add `/complete` and `/progress` endpoints.
7. Remove checklist-driven progress writes and update checklist responses.
8. Update read-model serializers and aggregate checklist summaries.
9. Add e2e tests around the new API contracts.
10. Run frontend smoke checks against Kanban, task detail, mind map, and Gantt.

## Open Decisions

- Should the product allow multiple active Done statuses, or enforce exactly one active Done per project?
- When moving out of Done, should the backend always preserve `progress = 100`, or should it default to a lower value when no explicit progress is supplied? The requirements allow either but require consistency.
- Should `progress = 100` on `/progress` transition to Done automatically? Recommended first implementation: no, keep status changes explicit.
- Should parent Done transition complete descendants recursively without depth limit, or use a configured depth limit? Recommended first implementation: recursive all descendants with a defensive max depth matching existing tree limits.
- Do branch-linked checklist items mirror child completion only in rollup views, or should Done transitions also update linked parent checklist items? Recommended: update checklist items only as a result of explicit Done policy, not passive child completion.
