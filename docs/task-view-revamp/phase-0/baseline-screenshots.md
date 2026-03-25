# Phase 0 Baseline Screenshot Manifest

## Purpose

Capture before-state screenshots for visual regression comparison prior to Phase 1+ implementation.

## Target Routes

- Global board: `/kanban`
- Project board: `/projects/{projectId}/kanban`

## Required Baseline Shots

| ID    | File Name                                                               | View                                          | Status          |
| ----- | ----------------------------------------------------------------------- | --------------------------------------------- | --------------- |
| BL-01 | `docs/task-view-revamp/phase-0/baseline/01-board-default.png`           | Board loaded with default columns             | Pending capture |
| BL-02 | `docs/task-view-revamp/phase-0/baseline/02-board-with-filters.png`      | Filters visible with non-default values       | Pending capture |
| BL-03 | `docs/task-view-revamp/phase-0/baseline/03-column-task-tree.png`        | Expanded task/subtask tree in column          | Pending capture |
| BL-04 | `docs/task-view-revamp/phase-0/baseline/04-task-details-sheet.png`      | Task details sheet open (no focus mode)       | Pending capture |
| BL-05 | `docs/task-view-revamp/phase-0/baseline/05-task-details-focus-mode.png` | Task details with selected subtask focus mode | Pending capture |
| BL-06 | `docs/task-view-revamp/phase-0/baseline/06-project-kanban.png`          | Project-scoped board with guard path          | Pending capture |

## Capture Procedure

1. Start app with `npm run dev`.
2. Navigate to each target route and set representative data state.
3. Capture viewport at consistent resolution and zoom.
4. Save screenshots with exact names listed above.
5. Keep captures under `docs/task-view-revamp/phase-0/baseline/` for future regression diffing.

## Notes

- Repository currently has no browser automation/screenshot test harness installed, so baseline image collection is tracked here as a manual checklist artifact.
