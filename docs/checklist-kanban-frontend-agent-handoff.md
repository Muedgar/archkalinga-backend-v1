# Checklist Kanban Frontend Agent Handoff

## 1. Requested Changes

Checklist items are now the Kanban cards. Tasks and subtasks remain the ownership and branching tree, but the Kanban board should render checklist items grouped by checklist item `statusId`.

Completion is binary at checklist item level:

- `completed: true` means progress is `100`.
- `completed: false` means progress is `0`.
- Moving a checklist item into a Done status marks it complete.
- Moving a checklist item out of Done marks it incomplete.
- Task progress is not the source of truth for checklist Kanban completion.

Branched checklist items have extra Done validation:

- A checklist item with `branchedTaskId` can move to Done only when every checklist item in the entire descendant task tree under that branched child task is complete.
- A branched checklist item with no descendant checklist items is blocked from Done.
- The backend returns `409` blocker payloads with descendant task ids and incomplete checklist item details.

Permissions are relationship-based for checklist execution:

- Task or ancestor task creators can add, update, delete, group, branch, move, and validate checklist items.
- Assignees on the owning task/subtask can branch, update, move, validate, and complete checklist items on that task/subtask.
- Assignees cannot add or delete checklist items on a task/subtask they did not create.
- Reportees can update checklist item text only.
- Reportees cannot branch, move, validate completion, mark complete/incomplete, change status, rank, group, or item code.
- When an assignee branches a checklist item, the assignee becomes creator of the child task and can manage checklist items under that child branch.

## 2. Problems Addressed And Solutions

### Problem: Kanban cards were task-focused

The frontend previously treated tasks/subtasks as Kanban cards. The new workflow needs checklist items to be the cards users drag through statuses.

Solution:

- Use `GET /projects/:projectId/checklist-kanban` as the board read API.
- Render `columns` from `ProjectStatus`.
- Render `cards` from checklist items.
- Group cards by `card.statusId`.
- Sort cards by `rank` within a status column.

### Problem: Checklist completion could be inferred from task progress

Branched checklist items were at risk of being treated as complete when child task progress reached 100, even if descendant checklist items were not truly complete.

Solution:

- Treat `card.completed` as the checklist completion source of truth.
- Display `card.progress` as binary `0` or `100`.
- Do not infer checklist completion from `task.progress`.
- Use the move or validate APIs for Done transitions.

### Problem: Branched checklist Done transitions need descendant validation

A branched checklist item represents a child task/subtree. Marking it Done before child checklist work is done creates false completion.

Solution:

- Before or during a drag to Done, call the move endpoint.
- If backend returns `409`, show the blocked descendant checklist items from `details.incompleteChecklistItems`.
- Do not optimistically finalize Done state until the move request succeeds.

### Problem: Permissions differ by relationship

Project roles alone do not express the requested checklist workflow. Assignees need execution rights, while reportees should only edit text.

Solution:

- Use card capability flags:
  - `canBranch`
  - `canMove`
  - `canUpdate`
  - `canUpdateText`
  - `canManageChecklist`
- Enable branch/move/full edit controls only when the matching flag is true.
- For reportees, show only text-edit affordances when `canUpdateText=true` and `canUpdate=false`.
- Show add/delete/group controls only when `canManageChecklist=true`.

## 3. APIs And DTOs For Frontend Integration

### Checklist Kanban Board

```http
GET /projects/:projectId/checklist-kanban
```

Query DTO:

```ts
type ChecklistKanbanQueryDto = {
  taskId?: string;
  assigneeUserId?: string;
  reporteeUserId?: string;
  statusId?: string;
  includeDone?: boolean;
  includeFlat?: boolean;
  includeBranched?: boolean;
  search?: string;
  page?: number;
  limit?: number;
};
```

Response DTO:

```ts
type ChecklistKanbanBoard = {
  columns: ProjectStatus[];
  cards: ChecklistKanbanCard[];
  columnCounts: Record<string, number>;
  meta: {
    projectId: string;
    taskId: string | null;
    page: number;
    limit: number;
    count: number;
    pages: number;
    nextPage: number | null;
    previousPage: number | null;
  };
};

type ChecklistKanbanCard = {
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
  branchStatus: string | null;
  branchedTaskId: string | null;
  branchedTaskTitle: string | null;
  createdByUserId: string;
  canBranch: boolean;
  canMove: boolean;
  canUpdate: boolean;
  canUpdateText: boolean;
  canManageChecklist: boolean;
  assignedMembers: Array<{
    userId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    title: string | null;
  }>;
  reportee: {
    userId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    title: string | null;
  } | null;
};
```

### Move Checklist Item

```http
PATCH /projects/:projectId/tasks/:taskId/checklist/:itemId/move
```

Request DTO:

```ts
type MoveChecklistItemDto = {
  statusId: string;
  beforeItemId?: string;
  afterItemId?: string;
  reason?: string;
};
```

Response DTO:

```ts
type ChecklistItemMoveResponse = {
  item: TaskChecklistItem;
  task: ChecklistTaskSummary;
  effects: {
    previousStatusId: string;
    nextStatusId: string;
    previousCompleted: boolean;
    nextCompleted: boolean;
  };
  changedItemIds: string[];
  changedTaskIds: string[];
};

type ChecklistTaskSummary = {
  id: string;
  progress: number | null;
  completed: boolean;
  checklistSummary: {
    total: number;
    completed: number;
  };
};
```

Frontend use:

- Call this for drag/drop across columns and reordering within columns.
- Moving into a Done status sets `completed=true`.
- Moving out of Done sets `completed=false`.
- Respect `canMove`.

### Validate Checklist Completion

```http
POST /projects/:projectId/tasks/:taskId/checklist/:itemId/complete/validate
```

Success DTO:

```ts
type ChecklistItemCompletionValidationResponse = {
  allowed: true;
  itemId: string;
  branchedTaskId: string | null;
};
```

Blocked DTO:

```ts
type ChecklistDoneBlockedResponse = {
  statusCode: 409;
  code:
    | 'CHECKLIST_DONE_BLOCKED_BY_DESCENDANT_WORK'
    | 'CHECKLIST_DONE_BLOCKED_BY_EMPTY_BRANCH';
  message: string;
  details: {
    branchedTaskId: string;
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
  };
};
```

Frontend use:

- Optional preflight before dragging a branched card to Done.
- The move endpoint also performs the same validation, so preflight is not required.
- Respect `canMove`; reportees should not call this endpoint.

### Update Checklist Item

```http
PATCH /projects/:projectId/tasks/:taskId/checklist/:itemId
```

Request DTO:

```ts
type UpdateChecklistItemDto = {
  text?: string;
  completed?: boolean;
  orderIndex?: number;
  statusId?: string;
  rank?: string | null;
  checklistGroupId?: string | null;
  itemCode?: string | null;
};
```

Frontend use:

- Use this for text edits and compatibility checkbox edits.
- If sending `completed` or `statusId`, the backend applies the same transition rules as move.
- Reportees may send `{ text }` only.
- Assignees may send full update fields except add/delete operations.
- Prefer the move endpoint for Kanban drag/drop.

### Add Checklist Item

```http
POST /projects/:projectId/tasks/:taskId/checklist
```

Request DTO:

```ts
type AddChecklistItemDto = {
  text: string;
  orderIndex?: number;
  statusId?: string;
  rank?: string | null;
  checklistGroupId?: string | null;
  itemCode?: string | null;
};
```

Frontend use:

- Show only when `canManageChecklist=true` for the relevant task/subtask.
- Assignees on a parent task do not get add rights unless they created that task/subtask.

### Delete Checklist Item

```http
DELETE /projects/:projectId/tasks/:taskId/checklist/:itemId
```

Frontend use:

- Show only when `canManageChecklist=true`.

### Branch Checklist Item

```http
POST /projects/:projectId/tasks/:taskId/checklist/:itemId/branch
```

Request DTO:

```ts
type BranchChecklistItemDto = {
  title?: string;
  itemCode?: string | null;
  statusId?: string;
  taskTypeId?: string;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number | null;
  wbsCode?: string | null;
  weightPercent?: number | null;
  assignedMembers?: Array<{
    userId: string;
    role?: string;
  }>;
};
```

Frontend use:

- Show only when `canBranch=true`.
- Do not show branch controls to reportees unless they are also assignees or creators.
- After successful branch, refresh the Kanban board and task/subtask tree state.
