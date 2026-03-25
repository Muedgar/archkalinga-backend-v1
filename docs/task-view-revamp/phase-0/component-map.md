# Phase 0 Deliverable 1: Component Map

## Entry Points

- `app/(dashboard)/kanban/page.tsx:1` renders `Board` inside `RequirePermission` and dashboard shell.
- `app/(dashboard)/projects/[projectId]/kanban/page.tsx:1` renders the same `Board` with project scoping via `ProjectKanbanGuard`.

## Current Task View Architecture

```text
KanbanPage / ProjectKanbanPage
  -> Board (modules/kanban/components/board.component.tsx)
    -> filters toolbar (search, status, column, member, checklist)
    -> column creation collapsible
    -> DndContext + SortableContext
      -> SortableBoardColumn
        -> BoardColumn
          -> Column
            -> TaskTreeTaskNode / TaskTreeSubtaskNode / TaskTreeRow
            -> CreateTaskForm
    -> DragOverlay / DragOverlayCard
    -> TaskDetailsSheet (right-side sheet)
      -> task form sections (overview / details / side panels)
      -> recursive SubtaskNode tree
```

## Component Responsibilities

- `Board`: Orchestrates DnD lifecycle, filter state wiring, create/save/move handlers, and local detail selection state (`selectedTaskId`, `selectedSubtaskId`). Reference: `modules/kanban/components/board.component.tsx:231` and `modules/kanban/components/board.component.tsx:1021`.
- `SortableBoardColumn`: Adapts `useSortable` output into `BoardColumn`. Reference: `modules/kanban/components/board.component.tsx:1220`.
- `BoardColumn`: Reads board slice via selectors, materializes task entries visible to current user, passes callbacks to `Column`. Reference: `modules/kanban/components/board.component.tsx:1070`.
- `Column`: Renders task/subtask rows in card-like droppable surface and hosts quick-add form. Reference: `modules/kanban/components/board-column.component.tsx:198`.
- `TaskTreeRow`: Click target for both task and subtask opens current details sheet (subtask uses focus mode inside parent task, not replacement navigation). Reference: `modules/kanban/components/board-column.component.tsx:41`.
- `TaskDetailsSheet`: Single task detail surface (Sheet) with optional subtask focus/highlight behavior. Reference: `modules/kanban/components/task-details-sheet.component.tsx:444`.

## Store + Selector Dependencies

- Core types/state: `modules/kanban/store/interfaces/kanban.types.ts:3`.
- Slice reducers (drag, filters, task/subtask CRUD): `modules/kanban/store/slices/kanban.slice.ts:182`.
- Preview-aware selectors used by Board/BoardColumn: `modules/kanban/store/kanban.selectors.ts:63` and `modules/kanban/store/kanban.selectors.ts:166`.

## Reusable UI + Theme Tokens for Revamp

- Dark/light tokens and shared semantic color variables: `app/globals.css:6` and `app/globals.css:81`.
- Table primitives available for subtask table implementation: `components/ui/table.tsx:7`.
- Card primitives available for task card redesign: `components/ui/card.tsx:5`.

## Observed Reuse Candidates for Phase 1+

- Reuse `TaskTreeRow` data recursion patterns while swapping visual container from row-cards to table rows.
- Reuse `MembersMultiSelect`, checklist/comment reducers, and `KanbanTask/KanbanSubTask` graph shape.
- Reuse selector pattern `selectTaskIdsForColumn` for preview-safe rendering while introducing navigation store.
