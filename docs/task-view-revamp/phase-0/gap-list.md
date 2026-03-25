# Phase 0 Deliverable 3: Gap List Against Target UX

## Requirement Gap Matrix

| Area                            | Required                                                                  | Current State                                                             | Gap                                                |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Subtasks presentation           | Subtasks in table (`Name`, `Assignee`, `Priority`, `Due Date`, `Actions`) | Subtasks shown as collapsible tree rows inside cards (`TaskTreeRow`)      | Missing table structure, headers, and data columns |
| Subtask click behavior          | Replace detail with clicked subtask detail view                           | Opens parent task sheet and highlights subtask node                       | Missing entity-level subtask detail navigation     |
| Back navigation                 | Multi-level back to root task                                             | No navigation stack; only sheet close                                     | Missing stack model and back control               |
| Breadcrumbs                     | Clickable task path                                                       | Focus-mode text path only, no ancestor jump behavior                      | Missing breadcrumb navigation actions              |
| Card visual style               | Compact dark cards with status chip, count, mark complete, quick actions  | Functional card-like rows, different structure, no target header controls | Visual and control mismatch                        |
| Subtask inline add row in table | Add row at bottom of table                                                | Quick-add form exists per column, not table footer row                    | Missing table add-row interaction                  |
| Shared navigation state         | Single source of truth for selection and traversal                        | Selection is local React state in `Board`                                 | Missing centralized navigation store/slice         |
| View replacement                | In-place replacement of task detail panel                                 | Side `Sheet` overlay from right                                           | Missing replacement layout architecture            |

## Detailed Findings

### 1) Selection and Navigation

- Current selection is local to `Board` via `selectedTaskId` and `selectedSubtaskId`, which prevents global traversal and breadcrumb composition across views. Reference: `modules/kanban/components/board.component.tsx:234`.
- Subtask opening is represented as `(taskId, subtaskId)` pair and still renders parent task object in details sheet. Reference: `modules/kanban/components/board.component.tsx:976` and `modules/kanban/components/board.component.tsx:1023`.

### 2) Detail View Mode

- The current details experience is a right-side modal sheet (`SheetContent`) with close semantics, not a replace-in-place view. Reference: `modules/kanban/components/task-details-sheet.component.tsx:562`.
- “Focus mode” is visual-only and exits by closing the sheet, not by stack pop/back semantics. Reference: `modules/kanban/components/task-details-sheet.component.tsx:602`.

### 3) Subtask Rendering

- Subtasks are recursively rendered as collapsible nodes with depth indentation and no tabular metadata columns. Reference: `modules/kanban/components/board-column.component.tsx:41`.
- Existing state shape supports recursion (`subtasksById`, `subtaskRootIds`, `childIds`) and is compatible with future table tree rendering. Reference: `modules/kanban/store/interfaces/kanban.types.ts:13` and `modules/kanban/store/interfaces/kanban.types.ts:26`.

### 4) UI Reuse and Styling Readiness

- Shared dark theme tokens and semantic colors are already available and suitable for target visual direction. Reference: `app/globals.css:81`.
- Reusable table primitive exists and can be adopted directly for subtasks table foundation. Reference: `components/ui/table.tsx:7`.
- Reusable card primitive exists but current column cards are custom div layouts; migration path is straightforward. Reference: `components/ui/card.tsx:5`.

## Phase 0 Conclusions

- Data model is sufficient for hierarchical tasks/subtasks and assignment metadata.
- Main blocker for desired UX is architectural: navigation state and detail rendering mode.
- Visual parity work can proceed without backend changes once navigation foundation is implemented.
