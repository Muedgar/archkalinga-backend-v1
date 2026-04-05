# Kanban Gap Analysis + Milestone Plan

Date: 2026-02-04
Owner: Codex + Team
Scope: Frontend-only Kanban (Next.js + RTK + dnd-kit) with mocked backend

## 1) Summary

The current Kanban implementation is a solid foundation for task drag and drop with a preview vs canonical state separation and rank-based ordering for tasks. However, large portions of the world-class spec remain unimplemented, including column drag, task creation/editing flows, rules engine, search/filtering, accessibility, and UX polish.

This plan proposes milestones that preserve the existing architecture while incrementally adding missing capabilities without redesigning foundations.

## 2) Current Implementation Snapshot

### Implemented

- Normalized store: `tasksById`, `columnsById`, `columnOrder`.
- Preview vs canonical state separation for task dragging.
- Task drag and drop using `@dnd-kit` with RAF-batched preview.
- Optimistic commit + rollback support on save failure.
- Rank-based stable ordering for tasks (fractional indexing).
- Basic UI: board, columns, cards, drag overlay.

### Not Implemented

- Column dragging (preview + commit + rank for columns).
- Task creation form and schema validation.
- Column creation form and schema validation.
- Task details modal and editing flows.
- Subtasks, assignees, task metadata fields.
- Rules engine (WIP enforcement, locked columns, role rules).
- Cross-column search and filtering (selectors + UI).
- Accessibility improvements (keyboard drag, SR announcements).
- Visual polish (drop indicators, invalid feedback, WIP warnings).

## 3) Gap Analysis by Spec Section

### 3.1 Data Model

- Missing fields on `KanbanTask`: description, status, assignedMembers, reportee, subtasks, createdAt, updatedAt.
- Missing `rank` on `KanbanColumn` (needed for stable column ordering).
- `columnOrder` currently manual list; should be derived from column ranks or computed from them.

### 3.2 Store Architecture

- UI state lacks column-drag fields (`activeColumnId`, `colDragFrom`, `colDragOver`).
- Preview needs `columnOrder` alongside `columnsTaskIds` for column dragging.
- Snapshot needs `columnOrder` for rollback.

### 3.3 Creation & Editing

- No forms or schema validations for task/column creation.
- No task detail modal or editing actions.
- No non-drag move flow (dropdown change column).

### 3.4 Drag & Drop

- Task DnD is solid; column DnD missing.
- Rules validation on drop is missing.
- No invalid drop feedback or pre-drop validation surface.

### 3.5 Rules Engine

- No pure rule functions (WIP, required fields before Done, locked columns).
- No reason messaging or prevented drop surface.

### 3.6 Search & Filtering

- No search UI and no selectors for filtered rendering.
- Drag behavior under filtered views not handled.

### 3.7 Performance & Accessibility

- Some memoization exists, but no render instrumentation or large-board tuning.
- Keyboard DnD and SR announcements are missing.

### 3.8 UX Polish

- No insert indicator line, no invalid drop styling.
- No WIP warning affordances.

## 4) Risks / Design Notes

- Column rank and `columnOrder` must be carefully integrated to avoid index-based ordering.
- Filtered views must avoid mutating canonical order; drag should commit to canonical order.
- Rules engine should be pure and testable so UI can show reasons before drop.
- Column drag and task drag should be separated to avoid event collisions.

## 5) Milestone Plan (Recommended Build Order)

### Milestone 0: Baseline Audit + Types Alignment (1-2 sessions)

Deliverables:

- Expand types for task/column entities (data model compliance).
- Add missing UI state fields in store.
- Add TODO markers for each missing spec area.

### Milestone 1: Task + Column Creation (2-3 sessions)

Deliverables:

- Task creation form with Zod schema + validation.
- Column creation form with Zod schema + validation.
- Rank assignment for inserted tasks and columns.
- Actions and reducers for creating tasks/columns.

### Milestone 2: Task Details Modal + Editing (2-4 sessions)

Deliverables:

- Modal view + edit for task fields (title, description, assignees, subtasks).
- Non-drag move via dropdown (uses same validations).
- Persist updates to canonical state.

### Milestone 3: Column Dragging (2-3 sessions)

Deliverables:

- Column DnD with preview + commit + rollback.
- Rank-based column ordering updates.
- Column drag handle on header.

### Milestone 4: Rules Engine (2-3 sessions)

Deliverables:

- Pure rules module and validation API.
- WIP, locked columns, and required field checks.
- Invalid drop feedback (reason + styling).

### Milestone 5: Optimistic Save + Rollback Hardening (1-2 sessions)

Deliverables:

- Consistent rollback for all operations (drag, edit, create).
- Randomized failure in dev mode.
- Error surfacing patterns.

### Milestone 6: Search + Filters (2-3 sessions)

Deliverables:

- Global search bar + filter controls.
- Selector-driven filtering without canonical mutation.
- Drag respects filtered rendering.

### Milestone 7: Performance + Accessibility + Polish (2-4 sessions)

Deliverables:

- Render instrumentation (dev only) + memoization tuning.
- Keyboard DnD, ARIA labels, SR announcements.
- Insert indicators, invalid drop styling, WIP warnings.

## 6) Proposed Next Step

Proceed with Milestone 0: align types + store UI state and add TODOs, then move into Milestone 1.
