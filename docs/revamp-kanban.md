# Task View Revamp - Execution Plan

## 1. Objective

Revamp task management UX to support:

1. A **subtasks table** inside task detail view.
2. A **card-based task list/column** matching the provided reference.
3. **In-place drill-down navigation** where opening a subtask replaces the current detail view.
4. A **Back traversal system** (and breadcrumb path) to return up to the main/root task.
5. A consistent dark, compact visual style across table, cards, and detail views.

## 2. Scope

### In Scope

1. Subtasks table UI and interactions.
2. Card tasks column redesign.
3. Detail view replacement on subtask/task click.
4. Navigation stack + Back button + breadcrumb.
5. State model unification for task selection/navigation.
6. UX polish (hover/focus/transition), accessibility, and tests.

### Out of Scope

1. Backend schema redesign (unless required for missing fields).
2. Major workflow changes outside task/list/detail views.
3. Permissions model redesign (only consume existing permissions).
4. Mobile-native app redesign (web responsive behavior only).

---

## 3. UX Requirements (Source-Aligned)

### A. Subtasks Table (in Task Detail)

1. Table columns: `Name`, `Assignee`, `Priority`, `Due Date`, `Actions`.
2. Nested subtasks indicated with indentation and optional expand/collapse icon.
3. Row click (especially Name cell) opens selected subtask detail view.
4. Inline “Add Task” row at the bottom.
5. Compact dark styling with subtle borders and low-noise UI.

### B. Card Tasks View (List/Column)

1. Stack of bordered, rounded dark cards.
2. Header controls: status chip, count, “Mark complete”, plus button.
3. Per-card quick actions (icons/menu) and subtask count row.
4. Nested subtask cards visually distinct but stylistically consistent.
5. Footer “+ Add Task” action.

### C. Drill-Down Task Navigation

1. Clicking subtask replaces current detail content with subtask detail.
2. Top-level `Back` control pops to previous task in stack.
3. Multi-level traversal supported (deep nesting).
4. Root/main task has no further back step.

### D. Context/Orientation

1. Breadcrumb path shown in detail header:
   - Example: `Main Task / Subtask A / Subtask B`
2. Breadcrumb items are clickable for ancestor jump navigation.
3. Current task title and metadata remain prominent.

---

## 4. Functional Architecture

## 4.1 Navigation Model

Implement navigation as a stack:

1. On entering a child task: `push(currentTaskId)` then set `currentTaskId = childId`.
2. On Back: `pop()` and set `currentTaskId` to popped value.
3. On breadcrumb click: truncate stack to selected ancestor and set current accordingly.
4. Root condition: stack empty (or single-root model) disables/hides Back.

## 4.2 State Model (Single Source of Truth)

Centralize state in one store/context:

1. `currentTaskId`
2. `navigationStack: TaskId[]`
3. `viewMode` (card/table/detail split if applicable)
4. `expandedRows` (table nesting state)
5. `selectedListId` or list context
6. UI state persistence:
   - table sort
   - filters
   - scroll position
   - expanded nodes

## 4.3 Shared Task Node Contract

Unify task rendering logic between card and table:

1. Shared task interface:
   - `id`, `title`, `status`, `assignees`, `priority`, `dueDate`, `childrenCount`, `children[]`
2. Shared click/open behavior.
3. Shared permission checks and disabled states.

---

## 5. Implementation Phases

## Phase 0 - Baseline & Discovery

1. Audit current task/list/detail components.
2. Map where selection/navigation is currently handled.
3. Identify reusable components and style tokens.
4. Capture baseline screenshots for regression comparison.

**Deliverables**

1. Component map.
2. State-flow diagram.
3. Gap list against required UX.

**Phase 0 Artifact Pack**

1. `docs/task-view-revamp/phase-0/README.md`
2. `docs/task-view-revamp/phase-0/component-map.md`
3. `docs/task-view-revamp/phase-0/state-flow.md`
4. `docs/task-view-revamp/phase-0/gap-list.md`
5. `docs/task-view-revamp/phase-0/baseline-screenshots.md`

---

## Phase 1 - Data + State Foundation

1. Introduce/normalize centralized task navigation store.
2. Add stack operations:
   - `openTask(taskId)`
   - `goBack()`
   - `goToAncestor(taskId)`
   - `resetToRoot(rootTaskId)`
3. Add selectors for breadcrumb and back availability.
4. Preserve table/card UI state across detail transitions.

**Acceptance Criteria**

1. Programmatic task drill-down works without page reload.
2. Back operation returns exact previous task.
3. Deep nesting works (3+ levels minimum).

---

## Phase 2 - Subtasks Table Revamp

1. Build/upgrade subtasks table component.
2. Add required columns and row actions.
3. Support nesting UI (indentation/expand).
4. Wire row click to `openTask`.
5. Add bottom inline “Add Task”.

**Acceptance Criteria**

1. Table visually matches reference intent (dark compact).
2. Clicking subtask opens its detail in-place.
3. Returning back preserves table state (sort/expand/scroll).

---

## Phase 3 - Card Tasks View Revamp

1. Build reusable `TaskCard` component:
   - top controls
   - title
   - quick actions
   - subtask row
2. Compose card column list with nested card support.
3. Add “+ Add Task” at column bottom.
4. Wire card click to same `openTask` behavior as table rows.

**Acceptance Criteria**

1. Card layout and controls align with screenshot style.
2. Parent/subtask hierarchy is visually clear.
3. Card click opens detail consistently.

---

## Phase 4 - Detail Header Navigation UX

1. Add `Back` button in detail header.
2. Add breadcrumb path above/near title.
3. Make breadcrumb ancestors clickable.
4. Ensure root state behavior is clear.

**Acceptance Criteria**

1. Users can traverse back all the way to main/root task.
2. Breadcrumb reflects exact navigation path.
3. Breadcrumb jump and Back both keep UI stable.

---

## Phase 5 - Visual Polish + Motion + Accessibility

1. Apply consistent dark tokens for borders, surfaces, text hierarchy.
2. Add subtle transitions for detail replacement.
3. Improve hover/focus/active states.
4. Keyboard support:
   - row/card focus
   - Enter to open
   - optional Esc/Backspace for back
5. Add proper `aria` labels and semantic table roles.

**Acceptance Criteria**

1. Keyboard-only navigation path is complete.
2. Focus state always visible and logical.
3. No major contrast/accessibility violations.

---

## Phase 6 - Testing & QA Hardening

1. Unit tests:
   - stack push/pop/truncate
   - breadcrumb generation
2. Integration tests:
   - table row click -> detail switch -> back restore
   - card click -> detail switch -> back restore
3. Visual regression tests for:
   - table section
   - card column
   - detail header/back/breadcrumb
4. Manual QA for edge cases.

**Acceptance Criteria**

1. All critical navigation flows pass.
2. No regressions in existing task actions.
3. Edge cases handled gracefully.

---

## 6. Edge Cases Checklist

1. Opened task gets deleted while viewed.
2. Permission loss on child task.
3. Empty subtasks in table and card views.
4. Very long task titles (truncate/wrap strategy).
5. Large nested trees (performance and interaction).
6. Mixed loaded/unloaded children (lazy loading).
7. Broken references (parent missing).
8. Concurrent updates from another user/session.

---

## 7. Performance Plan

1. Avoid full-page re-renders on selection change.
2. Memoize heavy row/card renderers.
3. Virtualize list/table if task count is high.
4. Debounce expensive filtering/sorting actions.
5. Keep navigation operations O(1) or near-constant.

---

## 8. QA Scenarios (Must Pass)

1. From main task, click subtask A -> subtask B -> Back -> Back returns to main.
2. Breadcrumb click from level 3 to level 1 lands correctly.
3. Returning from detail restores previous table expanded state.
4. Returning from detail restores card list scroll position.
5. Add task from table and card entry points works.
6. Mark complete in card view reflects in detail and table view.
7. Keyboard open/back flow works without mouse.

---

## 9. Definition of Done

1. Subtasks table implemented and interactive.
2. Card tasks view restyled to target reference.
3. Drill-down replacement navigation fully functional.
4. Back + breadcrumb traversal complete and robust.
5. Tests added and passing for core flows.
6. Visual/interaction parity achieved across table, card, and detail.
7. Edge case handling confirmed in QA checklist.

---

## 10. Suggested Work Breakdown (Execution Order)

1. Baseline audit and state design.
2. Implement navigation stack/store first.
3. Implement table interactions next.
4. Revamp card components and wire same navigation.
5. Add back/breadcrumb header UX.
6. Polish visual/accessibility details.
7. Finalize tests, run QA, ship.

---

## 11. Risk Log & Mitigations

1. **Risk:** State fragmentation across components.
   - **Mitigation:** One shared store and shared open/back actions.
2. **Risk:** Visual drift between card and detail/table.
   - **Mitigation:** Shared design tokens and reusable action/icon components.
3. **Risk:** Navigation bugs on deep nesting.
   - **Mitigation:** Unit tests for stack transitions and breadcrumb truncation.
4. **Risk:** Performance degradation on large task trees.
   - **Mitigation:** Memoization + optional virtualization.

---

## 12. Handoff Notes for Engineering

1. Keep behavior-driven commit structure:
   - `feat(nav): task stack navigation`
   - `feat(table): clickable subtasks table`
   - `feat(cards): redesigned task cards`
   - `feat(detail): back and breadcrumb`
   - `test(nav): stack and traversal coverage`
2. Attach before/after screenshots per phase for review.
3. Gate release behind quick UAT on core drill-down/back flows.
