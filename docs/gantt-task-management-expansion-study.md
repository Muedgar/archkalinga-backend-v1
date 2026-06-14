# Gantt Task Management Expansion Study

**Date:** 2026-06-14  
**Scope:** Compare the pasted Gantt/planning requirements with the current task management module, then define the backend expansion needed for a live Gantt chart, critical path, project calendar, resource/material/cost schedules, and WBS-style task hierarchy.

---

## 1. Executive Summary

The current task module can support a simple Gantt view today: it has tasks, parent/child hierarchy, start/end dates, progress, assignees, reportee, dependency edges, dependency types, lag storage, view metadata, and list/detail APIs that can return the needed rows.

The pasted scope is larger than a simple Gantt view. It describes a planning engine for construction/architecture work:

1. WBS hierarchy: phase, stage, activity, task, milestone.
2. Editable task scheduling inputs: duration, predecessors, dependency type, lag, manual date overrides.
3. Computed schedule values: ES, EF, LS, LF, float, critical path.
4. Project calendars with weekends and holidays.
5. Progress derived from milestone completion and optional weights.
6. Cost/material/resource schedules attached to tasks.
7. Allocation and variance views.
8. History and justification for status/date/price changes.

So the recommended path is not to keep stuffing all planning concepts into `tasks`. Keep `tasks` as the identity, hierarchy, ownership, and collaboration root, then add dedicated schedule sub-tables and calculation services around it.

---

## 2. Current Task Module Snapshot

### 2.1 Existing Strengths

Current entities already cover these Gantt foundations:

| Requirement area | Current support | Notes |
|---|---:|---|
| Task identity/name/details | Yes | `Task.title`, `Task.description` JSONB. |
| Project ownership | Yes | `Task.projectId`. |
| Parent/child hierarchy | Yes | `Task.parentTaskId` self-reference. |
| Move between parents | Yes | `moveTask` and `bulkUpdateTasks` support parent changes with descendant cycle prevention. |
| Assignees | Yes | `TaskAssignee` with `userId`, `projectRoleId`, `assignmentRole`. |
| Reportee | Yes | `Task.reporteeUserId`. |
| Start/end dates | Yes | `Task.startDate`, `Task.endDate`. |
| Progress | Yes | `Task.progress`, `Task.completed`. Currently user/status driven. |
| Dependencies | Partial/Yes | `TaskDependency` supports FS, SS, FF, SF and lag days. |
| Multiple predecessors | Yes | Multiple rows in `task_dependencies`. |
| Dependency cycle prevention | Yes | `ensureNoDependencyCycle`. |
| Gantt view metadata | Yes | `task_view_metadata` supports `viewType = gantt`. |
| Live update audit foundation | Partial | Task activity logs and outbox events exist, but schedule recalculation events are not modeled yet. |
| Large list query | Partial | `GET /projects/:projectId/tasks` supports pagination and includes, but Gantt needs a purpose-built windowed endpoint for thousands of rows. |

### 2.2 Current Gaps Against the Pasted Scope

| Pasted requirement | Current gap |
|---|---|
| Task Types: phase, stage, activity, task, milestone | Existing `ProjectTaskType` is configurable and currently closer to issue type/work item type. It should not be treated as the fixed schedule hierarchy without a migration decision. |
| Hierarchy order rules | Current hierarchy prevents cycles but does not enforce phase > stage > activity > task > milestone order. |
| WBS numbering | No WBS code/sequence is stored or generated. |
| Duration | No explicit duration field. Current duration is only inferable from `startDate`/`endDate`. |
| Negative lag | `AddDependencyDto.lagDays` currently has `@Min(0)`, so negative lag is blocked at API level. |
| Computed ES/EF/LS/LF/float | Not modeled or calculated. |
| Critical path | Not modeled or calculated. |
| Manual schedule overrides | Users can patch dates, but there is no override flag, reason, or schedule impact/audit model. |
| Project calendar | Project has start/end dates, but no working-day calendar, weekend rules, holidays, exceptions, or per-project calendar instance. |
| Milestones driving progress | Checklist items exist, but milestones as task Type and weighted progress are not modeled. |
| Cost schedule | No planned/actual labor/equipment/material cost model. |
| Activity materials | No material category/name/unit/quantity/rate/waste/cost/lookup status model. |
| Activity resources | No resource type/name/quantity/rate/status/allocation model. |
| Price history and justification | Not modeled. |
| Resource over-allocation analysis | Not modeled. |
| Gantt summary | Can be computed from tasks, but no endpoint returns started/completed/overdue/activity counts and progress summary. |
| Timeline scale/window | No dedicated day/week/month/quarter/year Gantt query contract. |
| Thousands of rows | Existing paginated task list works, but Gantt needs row virtualization/windowing, hierarchy-aware paging, and date-window filtering. |

---

## 3. Domain Modeling Recommendation

### 3.1 Separate Task Type From Schedule Type

The current `ProjectTaskType` is project-configurable and useful for product labels like Task, Bug, Feature, Story, Subtask. The pasted requirements need a planning hierarchy with fixed semantics:

1. `phase`
2. `stage`
3. `activity`
4. `task`
5. `milestone`

Recommended: add a dedicated `schedule_Type` column or schedule profile table instead of overloading `project_task_types`.

```ts
export enum ScheduleType {
  PHASE = 'phase',
  STAGE = 'stage',
  ACTIVITY = 'activity',
  TASK = 'task',
  MILESTONE = 'milestone',
}
```

This lets the backend keep project-defined task type labels while also enforcing Gantt/WBS rules.

### 3.2 Add Planning Fields To `tasks`

These fields belong on the task identity row because they affect hierarchy, tree ordering, and row rendering:

| Field | Purpose |
|---|---|
| `scheduleType` | Fixed Gantt/WBS Type. |
| `wbsCode` | Generated display code, for example `1.2.3`. |
| `wbsSortKey` | Stable sortable key for tree order and efficient queries. |
| `weightPercent` | Optional progress weight within siblings. |
| `isManuallyScheduled` | Marks user-overridden dates. |
| `manualScheduleReason` | Most recent justification for manual date override. |

Keep `startDate`/`endDate` during transition, but eventually treat them as denormalized display fields generated from the active schedule baseline, except when `isManuallyScheduled = true`.

### 3.3 Add Dedicated Schedule Tables

#### `project_calendars`

Per-project calendar instance.

| Column | Purpose |
|---|---|
| `project_id` | One calendar per project initially. |
| `timezone` | Calendar date boundaries. |
| `working_weekdays` | JSONB array or bitset, for example Monday-Friday. |
| `default_hours_per_day` | Useful later for hours-based scheduling. |
| `created_by_user_id` | Audit ownership. |

#### `project_calendar_exceptions`

Holidays and special work/non-work days.

| Column | Purpose |
|---|---|
| `calendar_id` | Calendar owner. |
| `date` | Exception date. |
| `is_working_day` | Whether this date is work or non-work. |
| `name` | Holiday/exception label. |
| `reason` | Optional explanation. |

#### `task_activity_schedules`

The main scheduling input/output row for each schedulable task.

| Column | Input/computed | Purpose |
|---|---|---|
| `task_id` | FK | One schedule per task per baseline/current version. |
| `duration_days` | Input | Working-day duration. Milestones should be 0. |
| `planned_start_date` | Computed/input | CPM result unless manually overridden. |
| `planned_end_date` | Computed/input | CPM result unless manually overridden. |
| `actual_start_date` | Input | Execution tracking. |
| `actual_end_date` | Input | Execution tracking. |
| `early_start_date` | Computed | ES. |
| `early_finish_date` | Computed | EF. |
| `late_start_date` | Computed | LS. |
| `late_finish_date` | Computed | LF. |
| `total_float_days` | Computed | Float/slack. |
| `free_float_days` | Computed | Optional, useful for planners. |
| `is_critical` | Computed | Critical path marker. |
| `is_manually_scheduled` | Input | Date override flag. |
| `manual_reason` | Input | Required when user overrides dates. |
| `calculated_at` | Computed | Recalculation timestamp. |

#### `task_schedule_overrides`

Append-only history of manual date/duration changes.

| Column | Purpose |
|---|---|
| `task_id` | Changed task. |
| `field_name` | `startDate`, `endDate`, `durationDays`, etc. |
| `old_value` / `new_value` | Audit diff. |
| `reason` | Required justification. |
| `created_by_user_id` | Actor. |

#### `task_schedule_calculation_runs`

Stores each recalculation run so the UI can explain why a task is critical or why dates moved.

| Column | Purpose |
|---|---|
| `project_id` | Project recalculated. |
| `trigger_task_id` | Optional task that caused recalculation. |
| `trigger_type` | Dependency change, duration change, calendar change, manual override, status change. |
| `started_at` / `finished_at` | Runtime info. |
| `status` | success/failed. |
| `summary_json` | Counts and critical path IDs. |

#### `task_schedule_explanations`

Optional but valuable for "why is this critical?"

| Column | Purpose |
|---|---|
| `calculation_run_id` | Run source. |
| `task_id` | Explained task. |
| `is_critical` | Snapshot. |
| `driving_predecessor_ids` | JSONB list of predecessors controlling ES/EF. |
| `successor_pressure_ids` | JSONB list of successors controlling LS/LF. |
| `explanation_json` | Human-readable evidence and path comparison data. |

### 3.4 Add Cost, Material, And Resource Schedules

These should be separate from activity scheduling so the timeline model stays clean.

#### `task_cost_schedules`

| Column | Purpose |
|---|---|
| `task_id` | Owning task. |
| `planned_labor_cost` | Prediction. |
| `planned_equipment_cost` | Prediction. |
| `planned_material_cost` | Prediction. |
| `planned_total_cost` | Computed. |
| `actual_labor_cost` | Actual. |
| `actual_equipment_cost` | Actual. |
| `actual_material_cost` | Actual. |
| `actual_total_cost` | Computed. |
| `cost_variance` | Computed actual - planned. |

#### `task_materials`

| Column | Purpose |
|---|---|
| `task_id` | Owning task. |
| `category` | Material category. |
| `name` | Material name. |
| `unit` | Unit of measure. |
| `quantity` | Quantity. |
| `default_rate` | Default market rate. |
| `override_rate` | Optional project/task override. |
| `effective_rate` | Computed default/override rate. |
| `waste_percent` | Waste. |
| `material_cost` | Computed. |
| `lookup_status` | Pending/found/manual/etc. |

#### `task_material_price_history`

Append-only price changes with justification.

| Column | Purpose |
|---|---|
| `task_material_id` | Material row. |
| `old_rate` / `new_rate` | Price change. |
| `effective_date` | Price date. |
| `reason` | Required justification. |
| `created_by_user_id` | Actor. |

#### `task_resources`

| Column | Purpose |
|---|---|
| `task_id` | Owning task. |
| `resource_type` | Labor/equipment/other. |
| `name` | Resource name. |
| `quantity` | Quantity assigned. |
| `default_rate` | Default rate. |
| `override_rate` | Optional override. |
| `effective_rate` | Computed. |
| `cost` | Computed. |
| `status` | Planned/confirmed/unavailable/etc. |

Resource availability should inform allocation warnings, not the core schedule calculation, matching the pasted note that schedule depends on duration rather than labor availability.

---

## 4. Scheduling Rules

### 4.1 Hierarchy Rules

Recommended default order:

```text
phase -> stage -> activity -> task -> milestone
```

Rules:

1. Every task may have children.
2. Children must be lower than the parent in hierarchy order.
3. Milestones cannot have children.
4. Practical UI depth target is 10 levels, but backend can support arbitrary depth if cycle prevention remains.
5. Moving a task must regenerate WBS codes for the moved subtree and affected sibling ranges.

Open decision: If a `task` may contain another `task`, define whether equal-Type nesting is allowed. The pasted note says every task can have children but must follow hierarchy order; strict interpretation means no same-Type child. If repeated task levels are desired, add `levelDepth` while preserving `scheduleType`.

### 4.2 WBS Numbering

WBS should be generated from sibling order under each parent:

```text
1 Phase
1.1 Stage
1.1.1 Activity
1.1.1.1 Task
1.1.1.1.1 Milestone
```

Implementation notes:

1. Use existing `rank` for drag/drop ordering.
2. Generate `wbsCode` from sorted siblings.
3. Maintain a `wbsSortKey` for efficient ordering, for example padded segments: `0001.0003.0002`.
4. On move/reorder, recompute WBS for the affected parent scopes and descendant subtree.

### 4.3 Dependency And Lag Rules

Current dependency type support is already good:

1. FS: successor starts after predecessor finishes.
2. SS: successor starts after predecessor starts.
3. FF: successor finishes after predecessor finishes.
4. SF: successor finishes after predecessor starts.

Required changes:

1. Allow negative `lagDays` in DTO validation and DB rules.
2. Keep dependency cycle prevention.
3. Validate dependencies stay inside the same project.
4. During recalculation, use working days from the project calendar.

### 4.4 Date Calculation Rules

Recommended model:

1. Project start date is the root anchor.
2. Tasks without predecessors start at project start or parent/explicit anchor.
3. Duration is in working days.
4. `plannedStartDate` and `plannedEndDate` are calculated from dependencies, duration, lag, and calendar.
5. Manual overrides pin the changed date/duration and require a reason.
6. Manual overrides trigger downstream recalculation and store an explanation/audit event.
7. Parent task dates roll up from children:
   - parent start = minimum child start
   - parent end = maximum child end
   - parent duration = calendar-aware span or sum, depending on reporting mode

### 4.5 Progress Rules

Recommended behavior:

1. Milestone progress is binary: incomplete = 0, complete = 100.
2. A task with milestones derives progress from milestone weights.
3. A parent derives progress from child weights.
4. If no weights exist, split weight evenly across children.
5. Weights within a sibling group must sum to 100.
6. Manual progress entry can remain temporarily for migration, but computed progress should become authoritative for Gantt.

### 4.6 Critical Path Rules

Use a CPM service:

1. Build directed acyclic graph from task dependencies.
2. Forward pass computes ES/EF.
3. Backward pass computes LS/LF.
4. Float = LS - ES or LF - EF.
5. Critical when float is 0, or within a configurable threshold.
6. Store critical flags and explanations from each calculation run.

---

## 5. API Expansion

### 5.1 Task Create/Update

Extend current task payloads with scheduling fields:

```json
{
  "scheduleType": "activity",
  "durationDays": 5,
  "weightPercent": 20,
  "isManuallyScheduled": false,
  "manualScheduleReason": null,
  "dependencies": [
    {
      "dependsOnTaskId": "uuid",
      "dependencyType": "FS",
      "lagDays": -1
    }
  ]
}
```

Current `dependencyIds` only captures predecessor IDs and defaults type to FS. Keep it for backwards compatibility, but add richer dependency payload support.

### 5.2 Gantt Data Endpoint

Add a purpose-built endpoint instead of stretching the generic task list too far:

```http
GET /projects/:projectId/gantt
```

Query params:

| Param | Purpose |
|---|---|
| `scale` | `day`, `week`, `month`, `quarter`, `year`. |
| `startDate` / `endDate` | Timeline window. |
| `parentTaskId` | Load one hierarchy branch. |
| `criticalOnly` | Show only critical path tasks. |
| `includeCosts` | Include summary cost fields. |
| `includeResources` | Include resource allocation fields. |
| `limit` / `cursor` | Hierarchy-aware row windowing. |

Response shape:

```json
{
  "summary": {
    "today": "2026-06-14",
    "started": 10,
    "completed": 4,
    "overdue": 2,
    "activities": 22,
    "progress": 38
  },
  "calendar": {
    "timezone": "Africa/Kigali",
    "workingWeekdays": [1, 2, 3, 4, 5],
    "exceptions": []
  },
  "rows": [
    {
      "id": "uuid",
      "parentTaskId": null,
      "wbsCode": "1",
      "scheduleType": "phase",
      "title": "Admin & site setup",
      "startDate": "2026-06-15",
      "endDate": "2026-07-10",
      "durationDays": 20,
      "progress": 45,
      "status": { "id": "uuid", "name": "In Progress", "category": "in_progress" },
      "assignees": [],
      "reportee": null,
      "isCritical": true,
      "floatDays": 0,
      "dependencies": []
    }
  ],
  "page": {
    "nextCursor": "opaque-cursor",
    "limit": 30
  }
}
```

### 5.3 Schedule Recalculation Endpoint

```http
POST /projects/:projectId/schedule/recalculate
```

Use when calendar, duration, dependency, or override changes need explicit recalculation. The service can also recalculate automatically after mutations, but an explicit endpoint is useful for admin repair and frontend "recalculate schedule" actions.

### 5.4 Critical Path Endpoint

```http
GET /projects/:projectId/schedule/critical-path
GET /projects/:projectId/tasks/:taskId/schedule/explanation
```

The first supports filtering/highlighting. The second answers "why did this task become critical?"

### 5.5 Calendar Endpoints

```http
GET /projects/:projectId/calendar
PATCH /projects/:projectId/calendar
POST /projects/:projectId/calendar/exceptions
PATCH /projects/:projectId/calendar/exceptions/:exceptionId
DELETE /projects/:projectId/calendar/exceptions/:exceptionId
```

### 5.6 Cost/Material/Resource Endpoints

Keep these under the task because they are task schedule submodules:

```http
GET /tasks/:taskId/cost-schedule
PATCH /tasks/:taskId/cost-schedule

GET /tasks/:taskId/materials
POST /tasks/:taskId/materials
PATCH /tasks/:taskId/materials/:materialId
GET /tasks/:taskId/materials/:materialId/price-history

GET /tasks/:taskId/resources
POST /tasks/:taskId/resources
PATCH /tasks/:taskId/resources/:resourceId
```

Add a project-level allocation view:

```http
GET /projects/:projectId/resources/allocation?startDate=...&endDate=...
```

---

## 6. Service Architecture

Recommended new services:

| Service | Responsibility |
|---|---|
| `TaskScheduleService` | CRUD around activity schedule fields and manual overrides. |
| `ProjectCalendarService` | Working days, holidays, date math. |
| `ScheduleCalculationService` | CPM forward/backward pass, rollups, critical path. |
| `WbsService` | WBS generation and subtree recomputation. |
| `TaskProgressService` | Milestone/child-weight progress rollups. |
| `TaskCostService` | Planned/actual cost calculations and variance. |
| `TaskMaterialService` | Material rows, rate history, lookup status. |
| `TaskResourceService` | Resource assignments and allocation warnings. |
| `GanttQueryService` | Optimized project timeline queries and row-window response shape. |

Do not put CPM, WBS, calendar math, and cost rollups into `TaskCrudService`. That service is already broad and should remain focused on task mutation orchestration.

---

## 7. Migration Strategy

### Phase 1: Gantt Readiness With Minimal Risk

1. Add `scheduleType`, `wbsCode`, `wbsSortKey`, `weightPercent`, and manual scheduling flags.
2. Add `durationDays` through `task_activity_schedules`.
3. Allow negative lag.
4. Add project calendar tables.
5. Add Gantt endpoint that returns current task rows plus schedule fields.

Outcome: frontend can render a richer Gantt with hierarchy, WBS, duration, task Type, and working-day awareness.

### Phase 2: Calculation Engine

1. Implement calendar-aware date math.
2. Implement dependency-based recalculation.
3. Store ES/EF/LS/LF/float/isCritical.
4. Add calculation run history.
5. Add critical-only filtering and explanation endpoint.

Outcome: backend becomes the source of truth for project timelines and critical path.

### Phase 3: Progress Rollups

1. Treat milestones as schedule Type.
2. Add milestone completion behavior.
3. Add weight validation.
4. Recompute task/parent/phase progress from milestones and children.

Outcome: Gantt progress is derived rather than manually typed.

### Phase 4: Cost, Material, Resource Schedules

1. Add cost schedule table.
2. Add material table and price history.
3. Add resource table.
4. Add resource allocation report.
5. Add cost variance calculations.

Outcome: Gantt becomes the live project progress and planning view, not just a timeline.

### Phase 5: History, Justification, And Real-Time Updates

1. Require reasons for date overrides, material price changes, and material-shortage schedule changes.
2. Emit outbox events for schedule recalculation, progress rollup, cost variance, and resource allocation warnings.
3. Add frontend-friendly diff payloads.

Outcome: project history explains why the timeline moved.

---

## 8. Data Integrity Rules To Enforce

1. `startDate <= endDate` remains required.
2. `durationDays >= 0`; milestones must use 0 duration.
3. `lagDays` can be negative.
4. Dependency edges must stay acyclic.
5. A dependency must stay inside the same project.
6. Child schedule Type must be lower than parent schedule Type unless the product explicitly allows same-Type nesting.
7. Milestones cannot have children.
8. Sibling weights must sum to 100 when weights are explicitly configured.
9. Calendar exceptions must be unique per calendar/date.
10. Manual schedule overrides require a reason.
11. Material price changes require a reason and history row.
12. Cost totals and variance should be computed server-side, not trusted from the client.

---

## 9. Frontend Contract Notes

The Gantt chart should not call the generic task list endpoint for everything long-term. It should consume a dedicated `GET /projects/:projectId/gantt` contract because it needs:

1. Summary counts.
2. Calendar metadata.
3. Hierarchy-aware row windowing.
4. Computed schedule fields.
5. Critical path markers.
6. Rollup progress.
7. Optional cost/resource overlays.

The visual task Type mapping can be driven by `scheduleType`:

| Type | Timeline visual |
|---|---|
| `phase` | Thick summary bar. |
| `stage` | Medium summary bar. |
| `activity` | Normal bar. |
| `task` | Small bar. |
| `milestone` | Diamond marker. |

The pasted note says milestones do not appear as bars because they summarize task percentage. A diamond marker is still useful when the frontend is in milestone-visible mode; otherwise milestones can be hidden and only contribute to progress.

---

## 10. Open Product Decisions

1. Should same-Type nesting be allowed, for example task under task, or must hierarchy always strictly move from phase to milestone?
2. Should parent duration be displayed as calendar span or sum of child working durations?
3. Should manual date override pin only the changed task, or also protect downstream dates from automatic movement?
4. Should milestones be stored as real tasks with `scheduleType = milestone`, or as a separate milestone table under a task?
5. Should cost/resource schedules be versioned by baseline, approval, and current actuals from day one?
6. Should the Gantt endpoint return all visible rows up to 30 per request, or should it support tree expansion cursors per parent branch?

---

## 11. Recommended Next Implementation Pass

Start with Phase 1 because it unlocks the frontend Gantt without prematurely building every calculator:

1. Add task schedule Type and WBS fields.
2. Add `task_activity_schedules` with duration, manual schedule flags, and placeholder computed fields.
3. Add project calendar and calendar exceptions.
4. Allow negative dependency lag.
5. Add a first `GET /projects/:projectId/gantt` endpoint that uses current task data plus the new schedule fields.
6. Add WBS generation on create/move/reorder.

This gives the app a real planning model while preserving the current task-management module and leaving CPM/cost/resource work as clean follow-up phases.
