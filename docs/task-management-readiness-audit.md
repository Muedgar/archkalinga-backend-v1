# Task Management — Readiness Audit

**Date:** 2026-03-25
**Scope:** Kanban, Mindmap, and Gantt chart readiness. Document management excluded.

---

## Overall Verdict

The implementation is **structurally sound and mostly ready**. All 8 entities, the migration, the module wiring, and the full endpoint surface are in place and correct. Three bugs need to be fixed before any view goes to production. Two are query-level issues and one is a serializer gap that directly affects Kanban card rendering.

---

## What Is Correctly Implemented

Every item from the implementation plan is present and working as intended:

**Foundation**

- All 8 entities match the plan exactly — `tasks`, `workflow_columns`, `task_assignees`, `task_checklist_items`, `task_comments`, `task_dependencies`, `task_view_metadata`, `task_activity_logs`.
- `AppBaseEntity` inheritance is correct on all entities (`pkid`, `id`, `version`, `createdAt`, `updatedAt`).
- `@Unique(['taskId', 'userId'])` on `TaskAssignee` and `@Unique(['taskId', 'dependsOnTaskId'])` on `TaskDependency` are present.
- `CHECK ("taskId" <> "dependsOnTaskId")` self-dependency constraint is in the migration.
- All 9 performance indexes are created in the migration.
- Foreign keys with correct cascade rules (`CASCADE`, `SET NULL`, `RESTRICT`) are all present.
- `TasksModule` is registered in `AppModule`.

**Domain logic**

- `verifyProjectMembership` runs at the top of every method.
- Parent task validation (`ensureParentTask`) confirms same-project and non-deleted.
- Assignee validation (`ensureAssigneeUsers`) confirms active project membership.
- Date range guard (`ensureDateRange`) enforces `startDate <= endDate`.
- `assertNotDescendant` BFS correctly prevents circular hierarchy on move/reparent.
- Cycle detection (`ensureNoDependencyCycle`) BFS runs before every new dependency edge.
- Soft-delete cascade: `deleteTask` BFS collects all descendants and soft-deletes in one `UPDATE ... WHERE id IN (...)`.
- `completed` flag is derived from status — set to `true` when `status === DONE` on both create and update.

**Rank / ordering**

- Fractional-index rank engine is implemented: midpoint calculation, append-to-end fallback, and full rebalance when gaps are exhausted.
- `moveTask` correctly calculates rank within the destination scope using `beforeTaskId`/`afterTaskId`.
- `bulkUpdateTasks` recalculates rank when scope changes (column or parent changes).

**All endpoints**

- All 24 endpoints from the plan are present in the controller with correct HTTP methods, routes, permission guards, and `@LogActivity` decorators.
- `PATCH /tasks/bulk` is declared before `PATCH /tasks/:taskId` in the controller, preventing routing ambiguity.
- `WorkflowColumnSerializer` inherits `id` from `BaseSerializer` (which has `@Expose() id`), so column IDs are returned correctly.
- `viewMeta` is correctly shaped in both serializers: `entries.reduce((acc, entry) => { acc[entry.viewType] = entry.metaJson; ... })` produces `{ mindmap: {...}, gantt: {...} }`.
- `TaskActivityLog` writes AND `ProjectActivityLog` writes happen together in `logTaskActivity` — task events are visible in the project contribution feed.

**Migration**

- All tables are created with `IF NOT EXISTS` guards and `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` guards on enums and FKs — safe to re-run.
- `down()` drops tables in dependency order.

---

## Bugs — Must Fix Before Use

### BUG 1 — CRITICAL: `include=comments` crashes the list endpoint

**File:** `tasks.service.ts`, `getProjectTasks`, lines 1652–1670

**What happens:** When a caller passes `include=comments` to `GET /projects/:id/tasks`, the query builder joins `task.comments` twice — once via `leftJoinAndSelect('task.comments', 'comments', ...)` and again via `loadRelationCountAndMap('task.comments', 'liveComments', ...)`. TypeORM cannot join the same relation with two different aliases in a single query builder and will throw a runtime error.

```typescript
// Line 1652 — first join of task.comments
if (includes.has('comments')) {
  qb.leftJoinAndSelect(
    'task.comments',
    'comments',
    'comments.deletedAt IS NULL',
  );
}

// Line 1665 — second join of task.comments (always present)
qb.loadRelationCountAndMap(
  'task.commentCount',
  'task.comments',
  'liveComments', // ← different alias, same relation
  (subQb) => subQb.andWhere('liveComments.deletedAt IS NULL'),
);
```

**Impact:** Kanban and Mindmap are unaffected since their recommended `include` parameters do not include `comments`. Gantt is also unaffected. However, any frontend code that requests `include=comments` on the list endpoint (e.g., to preload task sheets) will receive a 500 error.

**Fix:** Remove `loadRelationCountAndMap` for `commentCount` from the query builder. Instead, compute `commentCount` as a separate COUNT subquery or a raw scalar subquery added to the SELECT. Alternatively, use `addSelect` with a correlated subquery:

```typescript
qb.addSelect(
  (sub) =>
    sub
      .select('COUNT(*)', 'commentCount')
      .from(TaskComment, 'c')
      .where('c.taskId = task.id')
      .andWhere('c.deletedAt IS NULL'),
  'task_commentCount',
);
```

Then map the raw result onto each task before serializing.

---

### BUG 2 — HIGH: Assignee names are missing from the list serializer — breaks Kanban cards

**File:** `task-list-item.serializer.ts`, `TaskListAssigneeSerializer`

**What happens:** `TaskListAssigneeSerializer` only exposes `userId` and `assignmentRole`. The `user` relation (which holds `firstName`, `lastName`) is not loaded in `getProjectTasks` when `include=assignees` is set — the query only does `leftJoinAndSelect('task.assignees', 'assignees')`, not `leftJoinAndSelect('assignees.user', 'assigneeUser')`. As a result, Kanban task cards receive assignee IDs but no names or avatars.

```typescript
// task-list-item.serializer.ts
class TaskListAssigneeSerializer extends BaseSerializer {
  @Expose() userId: string;
  @Expose() assignmentRole: string;
  // ← firstName and lastName are missing
}

// tasks.service.ts — getProjectTasks
if (includes.has('assignees')) {
  qb.leftJoinAndSelect('task.assignees', 'assignees');
  // ← assignees.user is never joined
}
```

The full task detail (`GET /tasks/:id`) correctly loads `assignees.user` in `loadTaskOrFail` and the `TaskSerializer` exposes `firstName` and `lastName`. Only the list endpoint is affected.

**Fix:** Add the nested join and expose name fields:

```typescript
// In getProjectTasks
if (includes.has('assignees')) {
  qb.leftJoinAndSelect('task.assignees', 'assignees').leftJoinAndSelect(
    'assignees.user',
    'assigneeUser',
  );
}
```

```typescript
// In TaskListAssigneeSerializer
class TaskListAssigneeSerializer extends BaseSerializer {
  @Expose() userId: string;
  @Expose()
  @Transform(({ obj }) => obj?.user?.firstName ?? null)
  firstName: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.user?.lastName ?? null)
  lastName: string | null;
  @Expose() assignmentRole: string;
}
```

---

### BUG 3 — MEDIUM: `assignedTo` filter + `include=assignees` produces a double-join error

**File:** `tasks.service.ts`, `getProjectTasks`, lines 1630–1644

**What happens:** When both `assignedTo` filter and `include=assignees` are active, the query joins `task.assignees` twice — once as `assignee_filter` (for the WHERE) and once as `assignees` (for the SELECT). TypeORM raises an error because the same relation is joined under two aliases.

```typescript
// Filtering join (line 1631)
if (filters.assignedTo) {
  qb.innerJoin('task.assignees', 'assignee_filter', 'assignee_filter.userId = :assignedTo', { ... });
}

// Include join (line 1643)
if (includes.has('assignees')) {
  qb.leftJoinAndSelect('task.assignees', 'assignees');  // ← second join on same relation
}
```

**Fix:** When `assignedTo` and `assignees` include are both active, reuse the `assignee_filter` alias and apply the select on it, or restructure the filter to use a `WHERE EXISTS` subquery instead of a join:

```typescript
if (filters.assignedTo) {
  qb.andWhere((subQb) => {
    const sub = subQb
      .subQuery()
      .select('1')
      .from(TaskAssignee, 'ta')
      .where('ta.taskId = task.id')
      .andWhere('ta.userId = :assignedTo', { assignedTo: filters.assignedTo })
      .getQuery();
    return `EXISTS ${sub}`;
  });
}
```

---

### BUG 4 — LOW: Wrong action type logged when deleting a dependency

**File:** `tasks.service.ts`, `deleteTaskDependency`, line 1516

**What happens:** The audit log entry for dependency removal records `TaskActionType.DEPENDENCY_ADDED` instead of a deletion action. The log reads "DEPENDENCY_ADDED" for both add and remove operations.

```typescript
// Line 1516
await this.logTaskActivity(
  tx,
  task,
  actorUser,
  TaskActionType.DEPENDENCY_ADDED,
  {
    // ← should be TASK_UPDATED or a new DEPENDENCY_REMOVED action type
    dependencyId: depId,
    operation: 'dependency_deleted',
  },
);
```

**Fix:** Either use `TaskActionType.TASK_UPDATED` (acceptable short-term) or add `DEPENDENCY_REMOVED = 'DEPENDENCY_REMOVED'` to the `TaskActionType` enum and add it to the migration enum type.

---

## View-Specific Readiness

### Kanban — Ready with caveats

| Requirement                                      | Status          | Notes                                                                    |
| ------------------------------------------------ | --------------- | ------------------------------------------------------------------------ |
| Fetch project columns with task count            | ✅ Ready        | `GET /projects/:id/columns`                                              |
| Fetch tasks per column                           | ✅ Ready        | `GET /projects/:id/tasks?workflowColumnId=X&include=assignees,checklist` |
| Create/move tasks between columns                | ✅ Ready        | `PATCH /tasks/:id/position` with `workflowColumnId`                      |
| Reorder within column                            | ✅ Ready        | `beforeTaskId`/`afterTaskId` rank engine                                 |
| Batch status update (drag-to-column on multiple) | ✅ Ready        | `PATCH /tasks/bulk`                                                      |
| Assignee names on cards                          | ❌ Bug 2        | List serializer missing `firstName`/`lastName`                           |
| WIP limit enforcement                            | ⚠️ Not enforced | `wipLimit` stored but backend does not reject tasks when limit reached   |
| Create/rename/delete columns                     | ✅ Ready        | Full column CRUD                                                         |

**Blocking:** Bug 2 must be fixed — Kanban task cards cannot show assignee avatars or names.

---

### Mindmap — Ready

| Requirement                              | Status   | Notes                                                                              |
| ---------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| Fetch all tasks with hierarchy           | ✅ Ready | `GET /projects/:id/tasks?include=viewMeta` — `parentTaskId` drives tree            |
| Save node positions (x, y, collapsed)    | ✅ Ready | `PATCH /tasks/:id` with `viewMeta.mindmap` upserts `task_view_metadata`            |
| Re-parent a task (drag to new parent)    | ✅ Ready | `PATCH /tasks/:id/position` with `parentTaskId` + cycle prevention                 |
| Child count for collapsed nodes          | ✅ Ready | `childCount` in list serializer via `loadRelationCountAndMap`                      |
| Arbitrary depth nesting                  | ✅ Ready | Self-referential FK with `assertNotDescendant` BFS guard                           |
| Batch node layout save after auto-layout | ⚠️ Gap   | `PATCH /tasks/bulk` does not accept `viewMeta` — requires N individual PATCH calls |

**Blocking:** None. Mindmap is the most complete of the three views.

**Recommendation:** Add `viewMeta` support to `BulkUpdateTasksDto` to avoid N individual API calls after automatic re-layout.

---

### Gantt — Ready

| Requirement                                        | Status          | Notes                                                                                       |
| -------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| Fetch all tasks with dates, progress, dependencies | ✅ Ready        | `GET /projects/:id/tasks?include=assignees,dependencies,viewMeta`                           |
| Store dependency type (FS/SS/FF/SF) and lag        | ✅ Ready        | `task_dependencies.dependencyType` + `lagDays`                                              |
| Cycle prevention                                   | ✅ Ready        | BFS cycle check before every edge insert                                                    |
| Update bar dates (drag resize)                     | ✅ Ready        | `PATCH /tasks/:id` with `startDate`/`endDate`                                               |
| Update progress                                    | ✅ Ready        | `PATCH /tasks/:id` with `progress`                                                          |
| Gantt bar color override                           | ✅ Ready        | `viewMeta.gantt.barColor` stored in `task_view_metadata`                                    |
| Parent-child indentation                           | ✅ Ready        | `parentTaskId` drives nesting rows                                                          |
| Date-sequence enforcement on dependencies          | ⚠️ Not enforced | Backend does not validate `successor.startDate >= predecessor.endDate`; enforce client-side |

**Blocking:** None. Gantt is ready for frontend integration.

---

## Additional Notes

**Pagination and full-project fetches.** All three views need all tasks in a project at once. The list endpoint defaults to `limit=10`. Frontends should request `limit=500` (or the practical max for the project) until a streaming or all-tasks variant is added. The API supports this already via the `limit` query param.

**`include` cap.** `MAX_TASK_LIST_INCLUDES = 4` limits combined includes per request. Gantt wants `assignees,dependencies,viewMeta` (3 includes) — within the cap. If `checklist` is added it hits 4. Fine.

**`verifyProjectMembership` is not bypassed for admins.** Unlike the projects list (where admins see all projects), admins must be explicit project members to access tasks. This is consistent with the plan but may be surprising for admin users managing tasks.

**`updateTask` checklist replacement.** When `checklistItems` is passed to `PATCH /tasks/:id`, all existing checklist items are deleted and re-inserted. This is intentional (full replace semantics matching `assignedMembers`) but the frontend should not use this path for toggling individual items — use `PATCH /tasks/:id/checklist/:itemId` for that.

---

## Fix Priority

| #   | Bug                                            | Severity | Blocks                                     |
| --- | ---------------------------------------------- | -------- | ------------------------------------------ |
| 1   | `include=comments` double-join crash           | Critical | Any client requesting comment data in list |
| 2   | Assignee names missing from list serializer    | High     | Kanban card rendering                      |
| 3   | `assignedTo` + `include=assignees` double-join | Medium   | Filtered Kanban with assignee data         |
| 4   | Wrong action type on dependency delete log     | Low      | Audit trail accuracy only                  |
| 5   | Bulk endpoint doesn't support `viewMeta`       | Low      | Mindmap reflow efficiency                  |
