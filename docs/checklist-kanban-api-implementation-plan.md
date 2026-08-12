# Checklist Kanban API Implementation Plan

## Source Requirement

Kanban cards should become checklist items, not tasks or subtasks.

The task/subtask tree remains the ownership and branching structure:

- A task owns checklist items.
- A checklist item can be flat or branched into a child task.
- A branched child task follows the same task -> checklist -> branch -> child task pattern recursively.
- The task or subtask creator owns checklist and schedule management for that task subtree.
- Assignees can branch checklist items and own the subtasks they create, including checklist/schedule control all the way down their created branch.

Completion semantics also move down to checklist items for Kanban:

- Moving a checklist card into a Done status is equivalent to marking the checklist item complete.
- Moving a checklist card out of Done makes it incomplete.
- Checklist progress remains binary: complete = 100%, incomplete = 0%.
- Checklist items need a `statusId` for Kanban rendering and drag/drop.
- A branched checklist item can only enter Done when every checklist item in the descendant task tree under its branched child task is complete.

## Current Backend Baseline

Useful foundations already exist:

- `TaskChecklistItem` already stores `completed`, branch metadata, and `branchedTaskId`.
- `TaskChecklistService.branchItem` already creates a child task from a checklist item.
- `TaskProgressService.syncBranchedChecklistItems` already syncs branched checklist completion from child task progress, but this is now too task-progress-centric.
- `TaskCompletionTransitionService` already centralizes task Done transitions, blocker payloads, and status policy.
- `TaskAuthService.canMutateTaskSubresource` already grants task/subresource mutation to task or ancestor creators before role checks.
- Task tree and mindmap reads already understand branched checklist items and child task edges.

Behavior that must change:

- Kanban task movement currently uses `PATCH /projects/:projectId/tasks/:taskId/move`; checklist Kanban needs checklist-card movement.
- Checklist items currently have no `statusId`.
- Checklist completion currently does not have a dedicated status transition path.
- Task/subresource permission still falls back to project role permissions. Checklist/schedule ownership must override role presence or absence for owner-managed operations.
- Task progress rollups currently sync branched checklist item completion from child task progress. New rules should sync from descendant checklist completion instead.

## Core Product Invariants

1. Kanban columns still come from `ProjectStatus`.
2. Kanban cards are checklist items.
3. A checklist item has exactly one task owner through `taskId`.
4. A checklist item has binary progress:
   - `completed = true` means 100%.
   - `completed = false` means 0%.
5. `Task.progress` remains task-level rollup/reporting, but it is no longer the source of truth for checklist Kanban completion.
6. A flat checklist item can move freely between non-Done statuses and Done.
7. A branched checklist item can move to Done only when the entire descendant checklist tree below `branchedTaskId` is complete.
8. A branched checklist item with no child checklist items anywhere under the branched task cannot move to Done.
9. Moving a checklist item out of Done sets `completed = false`.
10. Checklist add/delete/group management is owned by the creator of the target task or a creator of an ancestor task in that branch, not by role permission.
11. Assignees may branch a checklist item on a task they are assigned to.
12. The actor who branches a checklist item becomes the creator/owner of the child task.

## Phase 1: Schema Changes

### Add checklist status

Update `src/tasks/entities/task-checklist-item.entity.ts`:

```ts
@ManyToOne(() => ProjectStatus, { nullable: false, onDelete: 'RESTRICT' })
@JoinColumn({ name: 'status_id', referencedColumnName: 'id' })
status: ProjectStatus;

@Column({ type: 'uuid', nullable: false, name: 'status_id' })
statusId: string;
```

Migration:

- Add `status_id uuid null` to `task_checklist_items`.
- Backfill existing rows:
  - completed checklist items -> the project active Done status.
  - incomplete checklist items -> the parent task status, or the project default status if the task status is unavailable.
- Alter `status_id` to `not null`.
- Add FK to `project_statuses(id)`.
- Add index: `(task_id, status_id, order_index)`.
- Add index: `(status_id, order_index)`.

### Add checklist Kanban rank

`orderIndex` works within a task checklist, but Kanban movement needs stable ordering inside a status column. Add:

```ts
@Column({ type: 'varchar', length: 50, nullable: true })
rank: string | null;
```

Migration:

- Backfill `rank` from current `orderIndex` in task scope.
- Keep `orderIndex` for checklist display inside task detail.
- Use `rank` for Kanban status-column ordering.

## Phase 2: DTOs and Serializers

### Checklist item serializers

Update:

- `TaskChecklistItemDetailSerializer`
- nested checklist item snippets in `TaskListItemSerializer`
- mindmap/tree checklist item mapping

Expose:

```ts
statusId: string;
status: {
  id: string;
  name: string;
  key: string;
  color: string;
  category: string;
  isDone: boolean;
} | null;
rank: string | null;
progress: 0 | 100;
canMoveToDone: boolean;
doneBlockedReason: string | null;
```

Implementation note:

- `progress` should be derived in serializers from `completed`.
- `canMoveToDone` can be omitted from normal list responses if expensive, but it should be returned by checklist Kanban board endpoints and preflight endpoints.

### Checklist mutation DTOs

Update `AddChecklistItemDto`:

- optional `statusId`.
- optional `rank` only if the API supports explicit placement.
- default status should be project default non-Done status.

Update `UpdateChecklistItemDto`:

- allow text/order/group changes.
- avoid accepting raw `completed` for Kanban moves once the move endpoint exists, or keep it as a simple checkbox path that delegates to the same transition service.

Add `MoveChecklistItemDto`:

```ts
{
  taskId?: string;        // optional future support for moving between task checklists
  statusId: string;
  beforeItemId?: string;
  afterItemId?: string;
  reason?: string;
}
```

For first implementation, reject cross-task moves unless product explicitly approves them.

## Phase 3: Checklist Completion Transition Service

Create:

`src/tasks/services/task-checklist-transition.service.ts`

Responsibilities:

- Validate target status belongs to the project.
- Apply checklist status transitions.
- Set `completed`, `completedAt`, and `completedByUserId`.
- Block branched checklist Done transitions when descendant checklist work is open or missing.
- Maintain rank/order within checklist Kanban columns.
- Return actionable blocker details.

Recommended method:

```ts
applyChecklistTransition(tx, {
  projectId,
  task,
  item,
  targetStatus,
  actorUser,
  beforeItemId,
  afterItemId,
  reason,
}): Promise<ChecklistTransitionResult>
```

Transition rules:

- Entering Done:
  - if flat: set `completed = true`, completion metadata, and `statusId = targetStatus.id`.
  - if branched: require descendant checklist tree complete before setting completion.
- Leaving Done:
  - set `completed = false`.
  - clear completion metadata.
  - set `statusId = targetStatus.id`.
- Non-Done to non-Done:
  - update `statusId`.
  - keep `completed = false`.
- Done to Done:
  - update `statusId` if multiple Done statuses are allowed.
  - keep `completed = true`.

Important:

- Do not derive checklist completion from `Task.progress`.
- Do not automatically complete child checklist items when a parent branched checklist card moves to Done; Done is allowed only after child checklist items are already complete.

## Phase 4: Descendant Checklist Completion Query

Add a reusable query helper, likely in `TaskChecklistTransitionService` or `TaskQueryService`:

```ts
loadDescendantChecklistCompletionState(tx, projectId, rootTaskId);
```

It should return:

```ts
{
  descendantTaskIds: string[];
  checklistItemCount: number;
  incompleteChecklistItemIds: string[];
  incompleteChecklistItems: Array<{
    id: string;
    taskId: string;
    title: string;
    statusId: string | null;
    branchedTaskId: string | null;
  }>;
}
```

Rules:

- Traverse all live descendants from `rootTaskId`, including the root child task itself.
- Ignore deleted tasks.
- If `checklistItemCount = 0`, block Done for the parent branched checklist item.
- If any descendant checklist item has `completed = false`, block Done.
- A descendant checklist item that is itself branched is complete only when its own `completed = true`; this is sufficient if every branched item is governed by the same transition rules.

Recommended SQL approach:

- Use a recursive CTE over `tasks.parent_task_id`.
- Join `task_checklist_items` on all returned task IDs.
- Keep this as one query for performance and consistency.

Blocked response:

```json
{
  "code": "CHECKLIST_DONE_BLOCKED_BY_DESCENDANT_WORK",
  "message": "Branched checklist item cannot be completed until all descendant checklist items are complete.",
  "details": {
    "branchedTaskId": "uuid",
    "descendantTaskIds": ["uuid"],
    "checklistItemCount": 3,
    "incompleteChecklistItemIds": ["uuid"],
    "incompleteChecklistItems": [
      {
        "id": "uuid",
        "taskId": "uuid",
        "title": "Install conduit",
        "statusId": "uuid",
        "branchedTaskId": null
      }
    ]
  }
}
```

## Phase 5: Checklist Kanban APIs

### Board endpoint

Add:

```http
GET /projects/:projectId/checklist-kanban
```

Query params:

```ts
{
  taskId?: string;          // optional root task/subtree filter
  assigneeUserId?: string;
  reporteeUserId?: string;
  statusId?: string;
  includeDone?: boolean;
  includeFlat?: boolean;
  includeBranched?: boolean;
  limit?: number;
  cursor?: string;
}
```

Response:

```ts
{
  columns: Array<ProjectStatusSerializer>;
  cards: Array<ChecklistKanbanCard>;
  columnCounts: Record<string, number>;
  meta: {
    projectId: string;
    taskId: string | null;
    nextCursor: string | null;
  }
}
```

`ChecklistKanbanCard`:

```ts
{
  id: string;
  taskId: string;
  taskTitle: string;
  parentTaskId: string | null;
  itemCode: string | null;
  text: string;
  statusId: string;
  rank: string | null;
  completed: boolean;
  progress: 0 | 100;
  branchStatus: 'flat' | 'branched';
  branchedTaskId: string | null;
  branchedTaskTitle: string | null;
  assignedMembers: Array<...>; // inherited from owning task
  reportee: ... | null;        // inherited from owning task
  createdByUserId: string;     // task owner
  canBranch: boolean;
  canMove: boolean;
  canUpdate: boolean;
  canUpdateText: boolean;
  canManageChecklist: boolean;
}
```

Visibility:

- Reuse task visibility rules.
- A checklist card is visible if its owning task is visible.

### Move endpoint

Add:

```http
PATCH /projects/:projectId/tasks/:taskId/checklist/:itemId/move
```

Body:

```ts
{
  statusId: string;
  beforeItemId?: string;
  afterItemId?: string;
  reason?: string;
}
```

Response:

```ts
{
  item: TaskChecklistItemDetailSerializer;
  task: {
    id: string;
    checklistSummary: { total: number; completed: number };
  };
  effects: {
    previousStatusId: string;
    nextStatusId: string;
    previousCompleted: boolean;
    nextCompleted: boolean;
  };
  changedItemIds: string[];
  changedTaskIds: string[];
}
```

### Preflight endpoint

Add:

```http
POST /projects/:projectId/tasks/:taskId/checklist/:itemId/complete/validate
```

Response when allowed:

```ts
{
  allowed: true;
  itemId: string;
  branchedTaskId: string | null;
}
```

Response when blocked:

- HTTP `409`
- same `CHECKLIST_DONE_BLOCKED_BY_DESCENDANT_WORK` details shape.

## Phase 6: Permission Model Changes

The new rule is owner-first and role-independent for checklist management.

### Checklist add/delete/group management

Allowed when:

- actor is the creator of the target task, or
- actor is the creator of any ancestor task in that branch.

Not allowed merely because:

- actor is an assignee on the target task.
- actor has `taskChecklistManagement.create/delete` role permission.

Implementation:

- Add `TaskAuthService.canManageTaskOwnedChecklist(projectId, taskId, userId)`.
- Add `TaskAuthService.assertTaskOwnedChecklistManagementAllowed(...)`.
- Reuse the existing ancestor creator traversal, but do not fall back to role permissions.
- Apply to:
  - `addChecklistItem`
  - `deleteChecklistItem`
  - `createChecklistGroup`
  - `updateChecklistGroup`
  - `deleteChecklistGroup`

### Checklist item update/move

Split permissions by operation:

- Text/order/group/delete/add: task owner/ancestor owner only.
- Move status/check complete: assignee, reportee, task owner/ancestor owner can act, subject to visibility.
- Branch: assignee, reportee, task owner/ancestor owner can act.

This keeps assignees able to execute work without letting them manage the parent task checklist structure.

### Branching ownership

`TaskChecklistService.branchItem` already sets:

- child task `createdByUserId = actorUser.id`.
- child task parent = owning task.

Keep that behavior.

Change branch auth so an assignee can branch a checklist item even when they cannot add/delete checklist items on the parent task.

## Phase 7: Service and Controller Integration

Update `TasksService`:

- Add `moveChecklistItem`.
- Add `validateChecklistItemCompletion`.
- Route add/delete/group calls through owner-only auth.
- Route branch calls through branch-specific auth.

Update `TasksController`:

- Add checklist move endpoint.
- Add checklist completion validate endpoint.
- Update Swagger text to state checklist Kanban semantics.

Add a new read method, likely in `TaskQueryService`:

- `getChecklistKanban(projectId, query, requestUser)`.

Controller option:

- Keep it under `TasksController` for project task APIs:
  - `GET /projects/:projectId/checklist-kanban`
- Or create `ChecklistKanbanController` if the controller is becoming too large.

## Phase 8: Rollup and Sync Adjustments

Implementation status: completed by removing the task-progress-based sync path.

`TaskProgressService` no longer loads or saves checklist items during project progress recalculation. Branched checklist completion is now updated only through explicit checklist transition paths such as checklist move or compatible checklist update calls.

`TaskQueryService.applyTreeRollups` also no longer mutates branched checklist item `completed` values while building tree responses.

Original target:

- Stop syncing branched checklist completion from child task progress.
- Either remove it, or change it to sync from descendant checklist completion using the new helper.

Recommended:

- Do not silently auto-complete branched checklist items during general task progress recalculation.
- Only update branched checklist completion through explicit checklist transitions.
- Keep task progress recalculation focused on task/subtask progress.

Add optional project repair job later:

- Recompute branched checklist completion consistency from descendant checklist state.
- Useful for migration/backfill, not normal request flow.

## Phase 9: Error Codes and Messages

Add to `src/tasks/messages/error.ts`:

- `CHECKLIST_DONE_BLOCKED_BY_DESCENDANT_WORK`
- `CHECKLIST_DONE_BLOCKED_BY_EMPTY_BRANCH`
- `CHECKLIST_STATUS_NOT_FOUND`
- `CHECKLIST_MOVE_FORBIDDEN`
- `TASK_CHECKLIST_MANAGEMENT_OWNER_REQUIRED`
- `TASK_CHECKLIST_BRANCH_FORBIDDEN`
- `CROSS_TASK_CHECKLIST_MOVE_UNSUPPORTED`

Recommended HTTP statuses:

- `403` for permission failures.
- `404` for missing task/item/status in project scope.
- `409` for Done blockers.
- `422` for invalid target status semantics.

## Phase 10: Migration and Backfill Strategy

1. Add nullable columns.
2. Backfill checklist item status and rank.
3. Run consistency checks:
   - every checklist item has a valid project status.
   - completed checklist items point to a Done status.
   - incomplete checklist items point to a non-Done status where possible.
4. Alter columns to not-null.
5. Add indexes and FK constraints.

Backfill edge cases:

- If a project has no active Done status, create or reuse a Done status before backfilling completed checklist items.
- If a task status belongs to another project due to legacy data issues, use project default status.
- If a completed checklist item is branched but descendant checklist items are incomplete, keep it completed during migration but emit a repair report. Do not silently flip production state unless product approves.

## Phase 11: Tests

Implementation status: completed as a manual verification/API-reference pass per request. No new unit tests were added in this phase.

Manual verification checklist:

- Schema migration adds `status_id` and `rank` to checklist items and backfills both.
- Checklist DTOs and serializers expose `statusId`, `status`, `rank`, and binary `progress`.
- Owner-only checklist management gates add/delete/group mutations.
- Assignees can branch, move, validate completion, and update checklist items without receiving parent checklist add/delete rights.
- Reportees can update checklist item text only; they cannot branch, move, validate completion, mark complete/incomplete, change status, rank, group, or item code.
- Checklist Done transitions use `TaskChecklistTransitionService`.
- Branched checklist Done transitions check descendant checklist completion and block empty branches.
- Checklist move and validate endpoints are present.
- Checklist Kanban board read endpoint is present.
- Task-progress recalculation no longer auto-syncs branched checklist completion from child task progress.
- Generic checklist updates with `completed` or `statusId` delegate to the transition service so they cannot bypass branched Done validation.
- `FRONTEND_API_REFERENCE.md` documents the board, move, validate, blocked error, and permission contracts.

### Unit tests

Add tests for `TaskChecklistTransitionService`:

- flat item moves to Done -> completed true.
- flat item moves out of Done -> completed false.
- branched item with complete descendant checklist tree moves to Done.
- branched item with incomplete descendant checklist tree returns 409 details.
- branched item with zero descendant checklist items returns 409 empty-branch details.
- non-Done to non-Done updates status and keeps completed false.
- Done to Done keeps completed true.

Add tests for `TaskAuthService`:

- task creator can add/delete checklist items.
- ancestor task creator can add/delete checklist items.
- assignee cannot add/delete checklist items on assigned parent task.
- assignee can branch checklist item on assigned parent task.
- assignee can update, move, and complete checklist items on assigned parent task.
- reportee can update checklist item text only.
- reportee cannot branch, move, or complete checklist items.
- assignee becomes child task creator and can add/delete checklist items on that child task.
- project role checklist permission alone does not grant owner-managed checklist add/delete.

### Service/controller tests

- `PATCH checklist/:itemId/move` returns effects and changed IDs.
- `GET checklist-kanban` returns checklist cards grouped by status.
- visibility filters hide checklist cards for tasks the user cannot see.
- rank ordering remains stable after moving within and across columns.

### Regression tests

- Existing task move endpoint still moves tasks/subtasks.
- Existing task completion endpoint still applies task-level status semantics.
- Branching still creates child tasks with correct parent, reportee inheritance, assignment, and WBS behavior.

## Phase 12: Frontend Contract Notes

Frontend should treat:

- `ProjectStatus` as columns.
- `TaskChecklistItem` as Kanban cards.
- `completed` as the source of checklist-card progress.
- `statusId` as the source of checklist-card column placement.
- `branchedTaskId` as the link to open the child task/subtask detail.

Frontend should not:

- infer checklist completion from `Task.progress`.
- manually set `completed` and `statusId` separately.
- allow parent checklist structural edits for assignees unless they own that task/subtask branch.

Recommended UI flow:

- Drag checklist card to Done.
- Call validate or move endpoint.
- If blocked, show incomplete descendant checklist items from response details.
- If allowed, refresh affected checklist card, owning task summary, and visible descendant cards.

## Suggested Build Order

1. Schema migration: `statusId` and `rank` on checklist items.
2. Serializers and DTOs for checklist status/rank.
3. Owner-only checklist management auth.
4. Assignee branch/move/update auth and reportee text-only update auth.
5. Checklist transition service and descendant completion query.
6. Checklist move and validate endpoints.
7. Checklist Kanban board read endpoint.
8. Remove or re-scope task-progress-based branched checklist sync.
9. Tests and API reference update.

## Open Implementation Decisions

- Whether checklist item `statusId` should default to parent task status or project default status on create. Recommendation: project default non-Done status for predictable checklist Kanban columns.
- Whether checklist item movement between owning tasks should ever be supported. Recommendation: reject for now.
- Whether role-based admins should have a superuser override for owner-managed checklist operations. Current requirement says no role override, so implementation should not include one unless product explicitly adds a workspace-admin exception.
- Whether multiple Done statuses are allowed for checklist items. Recommendation: support whatever `ProjectStatus` already supports, but ensure any `isDone = true` status maps to `completed = true`.
