# Activity Schedule Automation Implementation Plan

**Date:** 2026-06-14  
**Source workbook:** `/Users/mutanganaedgar/Downloads/Activity schedule.xlsx`  
**Scope:** Automate the activity schedule first: WBS hierarchy, duration, predecessor logic, ES/EF/LS/LF/float, critical path, stage/phase rollups, and project calendar support.

---

## 0. Completion Order

1. Add schedule identity fields to `tasks`: `scheduleType`, `wbsCode`, `wbsSortKey`, `weightPercent`, `isManuallyScheduled`, and `manualScheduleReason`.
2. Allow signed dependency lag by removing the non-negative validation from `lagDays` and treating negative lag as lead.
3. Add persistence tables for `project_calendars`, `project_calendar_exceptions`, `task_activity_schedules`, and schedule override/calculation history.
4. Add service and DTO support for creating/updating activity schedule fields: duration, planned dates, actual dates, and manual override reason.
5. Implement the CPM calculation engine for ES, EF, LS, LF, total float, free float, and critical path.
6. Implement WBS/stage/phase rollups so summary rows match the Excel schedule behavior.
7. Add read APIs for the activity schedule and critical path, ordered by WBS.
8. Add validate-only Excel import for `Activity schedule.xlsx`, then add upsert-by-WBS import after validation is reliable.
9. Add project-calendar date conversion so day offsets become working-day-aware dates.
10. Add tests for FS/SS/FF/SF, positive lag, zero lag, negative lag/lead, duplicate WBS validation, calendar exceptions, and summary rollups.

---

## 1. Workbook Analysis

The workbook contains one visible sheet, `Sheet1`, with 1,000 rows and 26 columns. The active schedule table uses columns A:P.

### 1.1 Visible Columns

| Column | Header | Meaning |
|---|---|---|
| A | Phase ID | Top-level WBS/phase identifier. |
| B | Phase Name | Formula lookup from a missing/external `WBS Map` sheet. |
| C | Stage ID | Stage WBS identifier. |
| D | Stage Name | Formula lookup from a missing/external `WBS Map` sheet. |
| E | Activity ID | Activity WBS identifier. |
| F | Activity Name | Formula lookup from a missing/external `WBS Map` sheet. |
| G | Predecessor | Previous activity ID. |
| H | Dependency Type | `FS` or `SS` in current data. |
| I | Lag | Days, including positive, zero, and negative values. |
| J | Duration | Duration in days. |
| K | ES | Early Start. |
| L | EF | Early Finish. |
| M | LS | Late Start. |
| N | LF | Late Finish. |
| O | Float | `LS - ES`. |
| P | Delta Duration | Formula lookup from a missing/external `Cost & Schedule` sheet. |

### 1.2 Row Types Found

| Row type | Count | Detection |
|---|---:|---|
| Activity rows | 139 | `Activity ID` and `Dependency Type` are present. |
| Stage summary rows | 17 | `Stage ID` exists, `Activity ID` is blank, duration/ES/EF/LS/LF are rollups. |
| Phase summary rows | 8 | `Phase ID` exists, `Stage ID` and `Activity ID` are blank, duration/ES/EF/LS/LF are rollups. |
| Blank rows | 830 | No visible values. |

### 1.3 Schedule Behavior In The Workbook

The sheet is already implementing a CPM-like schedule in Excel formulas.

1. `Project Duration` is calculated as `MAX(EF)` from activity rows.
2. `EF = ES + Duration`.
3. `LF = LS + Duration`.
4. `Float = LS - ES`.
5. ES calculation currently considers:
   - FS predecessor rule: predecessor EF + lag.
   - SS predecessor rule: predecessor ES + lag.
6. LS calculation currently considers successors:
   - FS successor pressure.
   - SS successor pressure.
7. Stage rows roll up from child activity rows:
   - duration/span = max LF - min ES.
   - ES = min child ES.
   - EF = max child EF.
   - LS = min child LS.
   - LF = max child LF.
8. Phase rows use `MINIFS`/`MAXIFS` rollups by Phase ID.

### 1.4 Data Findings

| Finding | Value |
|---|---:|
| Activity rows | 139 |
| Unique activity IDs | 136 |
| Duplicate activity IDs | 2 IDs duplicated across 5 rows total: `2.2.3.4`, `2.2.3.12` |
| Missing predecessor references | 0 |
| Dependency types | 132 `FS`, 7 `SS` |
| Lag range | -5 to 6 |
| Lag mix | 133 zero, 3 positive, 3 negative |
| Duration range | 0 to 7 |
| Zero-duration rows | 1 |
| Critical rows from cached float | 5 |

Important implication: the backend must allow negative lag. The current `AddDependencyDto` has `@Min(0)` on `lagDays`, so that must change for activity schedule automation.

### 1.5 Workbook Limitations To Fix In Backend

1. The workbook references missing or external sheets: `WBS Map` and `Cost & Schedule`.
2. Names are looked up by formulas instead of stored in the schedule table itself.
3. The current formulas only visibly handle `FS` and `SS`, while the backend already has `FS`, `SS`, `FF`, and `SF`.
4. Duplicate activity IDs exist; backend WBS/activity codes must be unique per project.
5. Excel cached results show many ES values as `0`, which means the workbook formulas may depend on calculation state or missing external sheets. Backend should calculate from source data directly, not trust cached spreadsheet values.
6. The workbook uses day offsets, not real calendar dates. Backend should calculate both day offsets and actual project-calendar dates.

---

## 2. Backend Target For Activity Schedule First

Activity schedule automation should be the first scheduling module, before cost schedule, material schedule, or resource schedule.

The backend should support:

1. WBS rows for phase, stage, activity, task, and milestone.
2. Duration in working days.
3. Multiple predecessors per task.
4. Dependency types: `FS`, `SS`, `FF`, `SF`.
5. Positive and negative lag.
6. ES, EF, LS, LF, total float, free float.
7. Critical path marker.
8. Project calendar and calendar exceptions.
9. Manual overrides with reason.
10. Summary rows and rollups for Gantt.
11. Import from an activity schedule workbook.

---

## 3. Data Model

### 3.1 Extend `tasks`

Add schedule identity fields directly to `tasks`.

| Field | Type | Purpose |
|---|---|---|
| `schedule_type` | enum | Fixed planning type: phase, stage, activity, task, milestone. |
| `wbs_code` | varchar | Display WBS code, for example `2.2.3.4`. |
| `wbs_sort_key` | varchar | Stable sortable key, for example `0002.0002.0003.0004`. |
| `weight_percent` | numeric nullable | Progress rollup weight. |
| `is_manually_scheduled` | boolean | Whether schedule dates were pinned by a user. |
| `manual_schedule_reason` | text nullable | Latest override reason. |

Recommended enum:

```ts
export enum ScheduleType {
  PHASE = 'phase',
  STAGE = 'stage',
  ACTIVITY = 'activity',
  TASK = 'task',
  MILESTONE = 'milestone',
}
```

Keep `ProjectTaskType` separate. `ProjectTaskType` remains the configurable product/work item label. `ScheduleType` is the fixed planning hierarchy used by WBS, Gantt, rollups, and scheduling rules.

### 3.2 `project_calendars`

Per-project calendar instance.

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid FK | Unique initially: one calendar per project. |
| `timezone` | varchar | Default can be `Africa/Kigali` or project/workspace setting. |
| `working_weekdays` | jsonb | Example `[1,2,3,4,5]` for Monday-Friday. |
| `default_hours_per_day` | numeric | Useful later; activity schedule can initially use days. |
| `created_by_user_id` | uuid FK | Audit. |

### 3.3 `project_calendar_exceptions`

| Column | Type | Notes |
|---|---|---|
| `calendar_id` | uuid FK | Owner calendar. |
| `date` | date | Exception date. |
| `is_working_day` | boolean | Allows holiday or special work day. |
| `name` | varchar | Holiday/exception name. |
| `reason` | text nullable | Explanation. |

Unique rule: one exception per calendar/date.

### 3.4 `task_activity_schedules`

One current schedule row per task in the first implementation. Later this can support baselines by adding `baseline_id` or `schedule_version_id`.

| Column | Type | Source | Purpose |
|---|---|---|---|
| `task_id` | uuid FK | system | Owning task. |
| `duration_days` | numeric | input | Working-day duration. |
| `planned_start_date` | date | computed/input | Calendar date for ES/planned start. |
| `planned_end_date` | date | computed/input | Calendar date for EF/planned finish. |
| `planned_start_offset` | numeric | computed | Excel-compatible ES offset. |
| `planned_end_offset` | numeric | computed | Excel-compatible EF offset. |
| `actual_start_date` | date nullable | input | Execution tracking. |
| `actual_end_date` | date nullable | input | Execution tracking. |
| `early_start_offset` | numeric | computed | ES. |
| `early_finish_offset` | numeric | computed | EF. |
| `late_start_offset` | numeric | computed | LS. |
| `late_finish_offset` | numeric | computed | LF. |
| `early_start_date` | date | computed | ES mapped through project calendar. |
| `early_finish_date` | date | computed | EF mapped through project calendar. |
| `late_start_date` | date | computed | LS mapped through project calendar. |
| `late_finish_date` | date | computed | LF mapped through project calendar. |
| `total_float_days` | numeric | computed | LS - ES. |
| `free_float_days` | numeric | computed | Optional but useful. |
| `is_critical` | boolean | computed | Critical path marker. |
| `is_manually_scheduled` | boolean | input | Local schedule pin. |
| `manual_reason` | text nullable | input | Required for manual pin. |
| `calculated_at` | timestamptz | computed | Last calculation timestamp. |

Why both offsets and dates: the workbook uses offsets like `0`, `5`, `7`, but the product needs Gantt dates. Storing both makes import/export and UI explanations easier.

### 3.5 `task_schedule_overrides`

Append-only audit for manual changes.

| Column | Type |
|---|---|
| `task_id` | uuid FK |
| `field_name` | varchar |
| `old_value` | jsonb |
| `new_value` | jsonb |
| `reason` | text |
| `created_by_user_id` | uuid FK |

### 3.6 `task_schedule_calculation_runs`

Stores every recalculation.

| Column | Type |
|---|---|
| `project_id` | uuid FK |
| `trigger_task_id` | uuid nullable |
| `trigger_type` | varchar |
| `started_at` | timestamptz |
| `finished_at` | timestamptz nullable |
| `status` | varchar |
| `summary_json` | jsonb |
| `error_message` | text nullable |

### 3.7 `task_schedule_explanations`

Optional in phase 1, but design the calculation service so this can be added cleanly.

| Column | Type |
|---|---|
| `calculation_run_id` | uuid FK |
| `task_id` | uuid FK |
| `is_critical` | boolean |
| `driving_predecessor_ids` | jsonb |
| `successor_pressure_ids` | jsonb |
| `explanation_json` | jsonb |

---

## 4. Calculation Rules

### 4.1 Calendar Date Math

For phase 1:

1. Project start date is day offset `0`.
2. Duration is in working days.
3. Weekend/holiday rules come from `project_calendars` and `project_calendar_exceptions`.
4. Offset fields are calculated first.
5. Date fields are derived by adding working-day offsets to project start.

### 4.2 Lag And Lead Semantics

Lag is stored as a signed number of days on the dependency edge.

```ts
dependencyType: 'FS' | 'SS' | 'FF' | 'SF';
lagDays: number; // positive, zero, or negative
```

Definitions:

1. Positive lag means wait after the predecessor condition is met.
2. Zero lag means no extra delay.
3. Negative lag is a lead. It allows the successor to start or finish before the predecessor fully reaches the dependency point.

Examples:

| Dependency | Lag | Meaning |
|---|---:|---|
| `FS` | `+3` | Successor starts 3 days after predecessor finishes. |
| `FS` | `-3` | Successor starts 3 days before predecessor finishes. |
| `SS` | `+2` | Successor starts 2 days after predecessor starts. |
| `SS` | `-2` | Successor starts 2 days before predecessor starts. |
| `FF` | `+3` | Successor finishes 3 days after predecessor finishes. |
| `FF` | `-3` | Successor finishes 3 days before predecessor finishes. |

Construction example:

```text
Build Wall:  ██████████
Paint Wall:        ███
```

This can be modeled as `Build Wall -> Paint Wall` with `FS -2 days`, meaning painting can start 2 days before wall construction fully completes.

Professional scheduling systems such as Microsoft Project and Primavera P6 support negative lag, but many planners prefer equivalent `SS` or `FF` relationships because they are easier to audit. For example, `FS -2` can often be expressed as `SS +8` when the predecessor duration is 10 days. Archkalinga should support negative lag because the existing workbook already uses it, but the UI should label it clearly as a lead.

### 4.3 Forward Pass

For each task in topological order:

1. If no predecessors, `ES = 0` or the manually pinned start offset.
2. For each predecessor relation:
   - `FS`: candidate ES = predecessor EF + lag.
   - `SS`: candidate ES = predecessor ES + lag.
   - `FF`: candidate EF = predecessor EF + lag, therefore candidate ES = candidate EF - duration.
   - `SF`: candidate EF = predecessor ES + lag, therefore candidate ES = candidate EF - duration.
3. Task `ES = max(candidate starts)`.
4. `EF = ES + duration`.

This matches the workbook for FS/SS and extends it to FF/SF.

### 4.4 Backward Pass

Use project duration as the maximum EF unless the project has a manually fixed end date.

For each task in reverse topological order:

1. If no successors, `LF = projectDuration`.
2. For each successor relation:
   - If this task is predecessor in FS: candidate LF = successor LS - lag.
   - If predecessor in SS: candidate LS = successor LS - lag, therefore candidate LF = candidate LS + duration.
   - If predecessor in FF: candidate LF = successor LF - lag.
   - If predecessor in SF: candidate LS = successor LF - lag, therefore candidate LF = candidate LS + duration.
3. Task `LF = min(candidate finishes)`.
4. `LS = LF - duration`.
5. `totalFloat = LS - ES`.
6. `isCritical = totalFloat <= threshold`, with threshold defaulting to `0`.

### 4.5 Summary Rollups

For phase/stage summary rows:

1. `ES = min(child ES)`.
2. `EF = max(child EF)`.
3. `LS = min(child LS)`.
4. `LF = max(child LF)`.
5. `duration/span = LF - ES` for workbook parity.
6. `float` can be null for summary rows or calculated as `LS - ES`; decide per frontend need.
7. `isCritical = any child critical` or `summary float = 0`; choose one and keep consistent.

### 4.6 Validation Rules

1. `scheduleType` must follow hierarchy rules.
2. WBS code must be unique per project.
3. Activity schedule rows require `durationDays`.
4. Milestone duration must be `0`.
5. Lag can be positive, zero, or negative; negative lag must be displayed/explained as lead.
6. Dependency cycles are invalid.
7. Dependencies must stay inside the same project.
8. Manual date/duration overrides require a reason.
9. Duplicate imported activity IDs should fail validation or be imported as separate revisions only if explicitly configured.

---

## 5. Import Plan For The Existing Excel Sheet

### 5.1 Import Endpoint

```http
POST /projects/:projectId/activity-schedule/import
Content-Type: multipart/form-data
```

Payload:

| Field | Meaning |
|---|---|
| `file` | Activity schedule workbook. |
| `mode` | `validateOnly`, `createMissing`, `upsertByWbsCode`. |
| `projectStartDate` | Optional override if project does not have start date. |

### 5.2 Import Parser

Parser should read columns A:P from the first sheet initially:

```ts
type ActivityScheduleImportRow = {
  rowNumber: number;
  phaseCode: string | null;
  phaseName: string | null;
  stageCode: string | null;
  stageName: string | null;
  activityCode: string | null;
  activityName: string | null;
  predecessorCode: string | null;
  dependencyType: 'FS' | 'SS' | 'FF' | 'SF' | null;
  lagDays: number | null;
  durationDays: number | null;
  earlyStartOffset: number | null;
  earlyFinishOffset: number | null;
  lateStartOffset: number | null;
  lateFinishOffset: number | null;
  totalFloatDays: number | null;
  deltaDurationDays: number | null;
};
```

### 5.3 Import Classification

1. Activity row: `activityCode` present and `dependencyType` present.
2. Stage summary row: `stageCode` present and `activityCode` blank.
3. Phase summary row: `phaseCode` present and `stageCode` blank.
4. Blank/unsupported row: ignore unless validate mode is strict.

### 5.4 Import Validation Report

Return a structured report before writing:

```json
{
  "valid": false,
  "summary": {
    "activities": 139,
    "stages": 17,
    "phases": 8,
    "duplicates": 2,
    "missingPredecessors": 0,
    "negativeLagRows": 3,
    "zeroDurationRows": 1
  },
  "issues": [
    {
      "row": 49,
      "severity": "error",
      "field": "activityCode",
      "message": "Duplicate activity code 2.2.3.4"
    }
  ]
}
```

### 5.5 Import Write Behavior

Recommended first behavior: `validateOnly` first, then `upsertByWbsCode`.

1. Create missing phase/stage/activity tasks.
2. Set `scheduleType` from row classification:
   - phase summary row -> `phase`.
   - stage summary row -> `stage`.
   - activity row -> `activity`, unless duration is `0`, then optionally `milestone`.
3. Set parent by WBS:
   - activity parent = stage.
   - stage parent = phase.
4. Create/update `task_activity_schedules`.
5. Create/update `task_dependencies` from predecessor columns.
6. Run backend recalculation.
7. Compare backend ES/EF/LS/LF/float to workbook cached values and return differences.

---

## 6. API Plan

### 6.1 Activity Schedule Read

```http
GET /projects/:projectId/activity-schedule
```

Query:

| Param | Purpose |
|---|---|
| `includeSummaryRows` | Include phase/stage rollups. |
| `criticalOnly` | Only rows where `isCritical = true`. |
| `parentTaskId` | Load one branch. |
| `limit` / `cursor` | Row-window pagination. |

### 6.2 Recalculate

```http
POST /projects/:projectId/activity-schedule/recalculate
```

Body:

```json
{
  "triggerType": "manual",
  "triggerTaskId": "uuid"
}
```

### 6.3 Update Schedule Fields

```http
PATCH /tasks/:taskId/activity-schedule
```

Body:

```json
{
  "durationDays": 5,
  "isManuallyScheduled": true,
  "plannedStartDate": "2026-06-15",
  "manualReason": "Material delivery moved earlier"
}
```

### 6.4 Calendar APIs

```http
GET /projects/:projectId/calendar
PATCH /projects/:projectId/calendar
POST /projects/:projectId/calendar/exceptions
PATCH /projects/:projectId/calendar/exceptions/:exceptionId
DELETE /projects/:projectId/calendar/exceptions/:exceptionId
```

---

## 7. Services To Add

| Service | Responsibility |
|---|---|
| `ProjectCalendarService` | Working-day math, holidays, exceptions, offset/date conversion. |
| `ActivityScheduleImportService` | Parse Excel, validate rows, classify row types, produce import report. |
| `TaskActivityScheduleService` | CRUD for duration, manual overrides, actual dates. |
| `ScheduleCalculationService` | Forward/backward CPM pass and critical path calculation. |
| `WbsService` | WBS sort key generation, parent-child mapping, rollup grouping. |
| `ActivityScheduleQueryService` | Optimized endpoint read model for Gantt/activity schedule UI. |

Do not overload `TaskCrudService`; it should call these services after task mutations when recalculation is needed.

---

## 8. Implementation Phases

### Phase 0: Contract And Migration Prep

1. Add `ScheduleType` enum.
2. Draft migrations for task planning fields.
3. Draft migrations for calendar and activity schedule tables.
4. Update docs/swagger DTO names around `scheduleType`, not `scheduleKind`.

Acceptance:

1. Schema compiles.
2. Existing task create/update remains backward-compatible.

### Phase 1: Activity Schedule Persistence

1. Add `TaskActivitySchedule` entity.
2. Add `ProjectCalendar` and `ProjectCalendarException` entities.
3. Add DTOs for reading/updating schedule fields.
4. Add `PATCH /tasks/:taskId/activity-schedule`.
5. Allow negative `lagDays` in dependency DTO/entity validation.

Acceptance:

1. Can store duration, manual flags, planned/actual dates, and lag.
2. Existing dependency cycle prevention still works.

### Phase 2: Calculation Engine

1. Implement graph builder from tasks + dependencies + activity schedules.
2. Implement forward pass.
3. Implement backward pass.
4. Store ES/EF/LS/LF/float/isCritical.
5. Create calculation run records.
6. Add tests for the workbook cases:
   - no predecessor.
   - FS + positive lag.
   - FS + negative lag.
   - SS + positive lag.
   - SS + negative lag.
   - zero duration milestone.

Acceptance:

1. Recalculation produces deterministic CPM fields.
2. Critical path is identifiable.
3. Calculation can be re-run safely.

### Phase 3: Rollups And Query Endpoint

1. Implement phase/stage rollups.
2. Add `GET /projects/:projectId/activity-schedule`.
3. Return rows in WBS order.
4. Include summary fields: project duration, critical row count, started/completed/overdue counts.

Acceptance:

1. API can power a Gantt table.
2. Phase/stage rows match workbook rollup semantics.

### Phase 4: Excel Import

1. Add workbook parser.
2. Add validate-only import report.
3. Add upsert-by-WBS import mode.
4. Compare backend-calculated CPM fields to workbook cached CPM fields.
5. Reject duplicate activity codes unless user chooses a conflict strategy.

Acceptance:

1. The provided workbook returns an import report showing 139 activities, 17 stages, 8 phases, and duplicate WBS issues.
2. Cleaned workbook data can be imported and recalculated.

### Phase 5: Calendar-Aware Dates

1. Convert offsets to dates using project calendar.
2. Respect weekends and exceptions.
3. Recalculate when calendar changes.
4. Store override history when manual dates change.

Acceptance:

1. Project-specific calendars affect planned start/end dates.
2. Holidays/non-working days are visible in schedule output.

---

## 9. Suggested Test Matrix

| Test | Expected |
|---|---|
| First task, duration 5, no predecessor | ES 0, EF 5. |
| FS predecessor with lag 0 | successor ES = predecessor EF. |
| FS predecessor with lag -4 | successor ES = predecessor EF - 4. |
| SS predecessor with lag 4 | successor ES = predecessor ES + 4. |
| Multiple predecessors | successor ES = max(all predecessor constraints). |
| Zero-duration milestone | ES = EF, LS = LF. |
| Dependency cycle | rejected. |
| Summary stage | min child ES, max child EF, min child LS, max child LF. |
| Calendar weekend | planned dates skip non-working days. |
| Holiday exception | planned dates skip exception when non-working. |
| Manual override without reason | rejected. |
| Duplicate WBS import | validation error. |

---

## 10. Immediate Next Step

Build Phase 0 and Phase 1 first:

1. Add `scheduleType`, `wbsCode`, `wbsSortKey`, `weightPercent`, `isManuallyScheduled`, and `manualScheduleReason` to `tasks`.
2. Add `project_calendars`, `project_calendar_exceptions`, and `task_activity_schedules`.
3. Change dependency lag validation to allow negative values.
4. Add `TaskActivityScheduleService` and `ProjectCalendarService` skeletons.
5. Add a validate-only Excel import parser so we can repeatedly test against `Activity schedule.xlsx` while building the calculator.

This creates the durable foundation for automating the spreadsheet without yet touching cost, material, or resource schedules.
