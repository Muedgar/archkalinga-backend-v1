# Frontend-Requested Task Progress API Plan

## Context

The frontend rollout for Kanban, task detail, Gantt, dashboard, and bulk task flows needs a few backend affordances beyond the current task progress/completion implementation.

Current backend behavior already covers the core invariant:

- Parent progress is derived from direct subtasks.
- Parent tasks cannot enter Done while direct subtasks are open.
- Manual progress edits are leaf-only.
- Completed leaf tasks stay at `progress = 100`.
- Done behavior is driven by `ProjectStatus.isDone` and `completionPolicy`.

This plan covers the remaining API gaps requested by the frontend plan.

## Phase 1: Expand Completion Conflict Details

### Goal

Return enough blocker information for the frontend to render a useful completion-blocker UI without immediate follow-up requests.

### Backend Changes

Files:

- `src/tasks/services/task-completion-transition.service.ts`
- `src/tasks/messages/error.ts`
- `src/tasks/services/task-auth.service.ts` or a small read helper if reuse is better

Add a typed conflict details shape:

```ts
type TaskDoneBlockedDetails = {
  openChecklistItemIds: string[];
  openChildTaskIds: string[];
  openChecklistItems: Array<{
    id: string;
    title: string;
    completed: boolean;
  }>;
  openChildTasks: Array<{
    id: string;
    title: string;
    statusId: string | null;
    progress: number | null;
  }>;
};
```

Implementation notes:

- Extend the existing blocker query to select checklist item `text` and child task `title`, `statusId`, and `progress`.
- Return both old ID arrays and expanded arrays for backwards compatibility.
- Keep direct child task checks scoped to live tasks only: `deletedAt IS NULL`.
- For checklist item title, map `text` to `title` in the response because the frontend requested `title`.

Acceptance:

- Completing a parent with open direct subtasks returns blocker IDs plus readable blocker rows.
- Existing frontend code that only reads `openChildTaskIds` keeps working.

## Phase 2: Formalize Completion Validation

### Goal

Support safe frontend preflight for dialogs, hover actions, and bulk flows.

### API

Use the existing endpoint with validate-only mode:

```http
POST /projects/:projectId/tasks/:taskId/complete
```

Body:

```json
{
  "completionMode": "validate_only",
  "statusId": "optional-done-status-id"
}
```

Response when allowed:

```ts
{
  allowed: true;
  taskId: string;
  statusId: string;
  effects: {
    checklistItemsCompleted: 0;
    descendantTasksCompleted: 0;
    rollupsRecalculated: false;
  };
  changedTaskIds: [];
  warnings: [];
}
```

Response when blocked:

- HTTP `409`
- `code: "TASK_DONE_BLOCKED_BY_OPEN_WORK_ITEMS"`
- Expanded conflict details from Phase 1.

Backend Changes:

- Update `TaskCrudService.completeTask` so `completionMode = validate_only` does not log `TASK_COMPLETED`.
- Return a validation response instead of a normal completed task response.
- Ensure validate-only never mutates task status, progress, checklist items, rollups, or activity logs.

Acceptance:

- Validate-only success is side-effect-free.
- Validate-only failure returns the same blocker payload as real completion.

## Phase 3: Add Reopen API

### Goal

Make leaving Done explicit and predictable for frontend UX.

### API

```http
POST /projects/:projectId/tasks/:taskId/reopen
```

Body:

```ts
{
  statusId?: string; // non-Done status. Defaults to project default non-Done status.
  progress?: number; // optional for leaf tasks, 0..99 recommended by UI
  reason?: string;
}
```

Response:

```ts
{
  task: TaskSerializer;
  audit: {
    previousStatusId: string;
    nextStatusId: string;
    previousProgress: number | null;
    nextProgress: number | null;
    reason: string | null;
  };
}
```

Rules:

- Target status must be non-Done.
- If the task has a completed parent, reopening must be rejected because it would violate the parent completion invariant.
- Parent task progress remains aggregate-derived after reopen.
- Leaf task behavior:
  - If `progress` is supplied, use it.
  - If omitted, preserve existing `progress = 100` for consistency with current move-out-of-Done semantics.

Backend Changes:

- Add `ReopenTaskDto`.
- Add `POST /tasks/:taskId/reopen` controller route.
- Add `TaskCrudService.reopenTask`.
- Reuse `TaskCompletionTransitionService.applyTransition` for leaving Done.
- Add activity metadata with previous/next status and progress.

Acceptance:

- Frontend can call a dedicated reopen action instead of encoding reopen as a move.
- Reopening a child under a completed parent is blocked with actionable details.

## Phase 4: Bulk Transition Partial Outcomes

### Goal

Let multi-select actions succeed per valid task while reporting blocked tasks individually.

### API

Keep the current endpoint:

```http
PATCH /projects/:projectId/tasks/bulk
```

Change response from a plain task list to:

```ts
{
  tasks: TaskListItemSerializer[];
  succeeded: string[];
  failed: Array<{
    taskId: string;
    code: string;
    message: string;
    details?: unknown;
  }>;
  changedTaskIds: string[];
}
```

Backend Changes:

- Add `BulkTaskMutationResultDto` serializer/type if the project keeps response DTOs explicit.
- Update `TaskCrudService.bulkUpdateTasks` to process items independently enough to collect per-item failures.
- Keep one transaction for successful mutations if practical, but do not let one validation failure cancel unrelated valid items.
- For Done/status transitions, reuse `TaskCompletionTransitionService`.
- For progress updates, keep leaf-only validation.
- Return refreshed list items for succeeded tasks.

Acceptance:

- Bulk Done reports exactly which parent tasks were blocked and why.
- Bulk progress reports parent-task failures while leaf updates succeed.
- `changedTaskIds` includes tasks changed by accepted transitions and rollup recalculation.

## Phase 5: Progress Edit Capability Hints

### Goal

Prevent frontend/backend policy drift for progress controls.

### Response Additions

Add to task list/detail serializers:

```ts
{
  canEditProgress: boolean;
  progressEditBlockedReason?: 'HAS_CHILDREN' | 'COMPLETED' | 'FORBIDDEN';
}
```

Rules:

- `HAS_CHILDREN` when live child count is greater than zero.
- `COMPLETED` when task is completed.
- `FORBIDDEN` when the caller lacks task update permission.
- `canEditProgress = true` only when no blocked reason applies.

Backend Changes:

- Extend task read model in `TaskMembersService.buildTaskReadModel` or the task query mapping layer.
- Use existing `childCount` and membership permission context where available.
- Add fields to `TaskSerializer` and `TaskListItemSerializer`.
- For endpoints that return a single task after mutation, make sure the normal `getTask` path computes the same fields.

Acceptance:

- Frontend can use server hints directly for task detail, Kanban cards, Gantt rows, and bulk selection controls.
- Permissions-aware disable states are consistent across views.

## Phase 6: Documentation and Regression Coverage

### Regression Coverage

No new unit tests are required for this phase. The earlier implementation phases already added focused backend tests around the changed services; Phase 6 keeps the remaining work to API documentation and a manual/API regression checklist.

Manual or API-level checks:

- Expanded blocker payload shape.
- Validate-only success has no task/checklist/activity mutation.
- Validate-only blocked response includes expanded blockers.
- Reopen success from Done to non-Done.
- Reopen blocked when parent is completed.
- Bulk mixed success/failure response.
- `canEditProgress` for leaf, parent, completed leaf, and forbidden user contexts.
- Checklist toggles do not directly change task progress.
- Parent progress is read-only and recalculates after child progress/status changes.

### Docs

Updated frontend API documentation with:

- Completion conflict response.
- Validate-only response.
- Reopen endpoint.
- Bulk response shape.
- Progress capability hints.

Recommended docs:

- `FRONTEND_API_REFERENCE.md`
- `docs/frontend-api-handoff.md`

## Rollout Order

1. Expanded conflict details.
2. Side-effect-free validate-only response.
3. Reopen endpoint and docs for move-out-of-Done behavior.
4. Bulk partial outcome response.
5. Progress capability hints.
6. Regression checklist and API handoff docs.

This order gives the frontend the blocker UI and preflight contract first, then unlocks safer detail, drag-and-drop, Gantt, and bulk flows.
