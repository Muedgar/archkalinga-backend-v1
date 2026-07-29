# Task Projection API Contracts

## Purpose

This document defines the API contracts for the two projection views described in the Phase 1 and Phase 2 task system documents:

- Mindmap: the recursive checklist/task shape below a selected Task.
- Gantt: the schedule/timeline shape below a selected Task.

Both APIs are read projections over the canonical Task domain. They must not introduce separate mindmap nodes, gantt items, or view-specific task records. View metadata may store layout preferences, but Task, checklist, dependency, schedule, permission, and event data remain authoritative in their existing domain tables.

## Shared Rules

### Authorization

All endpoints require:

- JWT authentication.
- Active project membership.
- `taskManagement.view` for read endpoints.
- `taskManagement.update` for layout metadata writes.

Task visibility must use the same project/task scoping already applied by `TaskAuthService.applyTaskVisibilityScope`. Projection APIs must never leak hidden sibling branches through edges, counts, dependencies, or summary totals.

### Historical Status

Default projection behavior:

- Exclude soft-deleted tasks.
- Exclude superseded tasks.
- Include completed tasks.

Admins may request deleted tasks where supported. Superseded tasks may be included explicitly for audit/replay views, but active UI views should keep them out by default.

### Envelope

All projection responses should use a stable envelope:

```json
{
  "meta": {},
  "summary": {},
  "data": {}
}
```

`meta.generatedAt` is always a server timestamp. If a response is truncated, `meta.truncated` must be `true` and the response must include enough cursor or branch context for the frontend to continue safely.

## Mindmap Read Contract

### Endpoint

```http
GET /projects/:projectId/tasks/:taskId/mindmap
```

This endpoint returns the visible recursive shape below one Task, including mixed checklist state: flat checklist items and checklist items that branched into child Tasks.

The existing `GET /projects/:projectId/tasks/:taskId/tree` endpoint can remain as a generic tree endpoint. The mindmap endpoint is a UI-ready projection with layout, permissions, and branch-edge semantics made explicit.

### Query Parameters

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `depth` | integer or `all` | `all` | Descendant levels to return. `0` returns only the root task. |
| `limit` | integer | `500` | Maximum task nodes returned. |
| `include` | CSV | `checklist,counts,progress,status,viewMeta,permissions` | Optional expansions. |
| `includeCompleted` | boolean | `true` | Include completed tasks. |
| `includeDeleted` | boolean | `false` | Admin-only audit option. |
| `includeSuperseded` | boolean | `false` | Include superseded tasks for audit views. |
| `collapsedMode` | `respect` or `ignore` | `respect` | Whether stored collapsed nodes stop descendant expansion. |
| `changedSinceEventId` | string | none | Optional incremental refresh boundary once event IDs are exposed to clients. |

Allowed `include` values:

- `checklist`
- `counts`
- `progress`
- `status`
- `assignees`
- `dependencies`
- `requests`
- `linkedTasks`
- `viewMeta`
- `permissions`
- `activitySchedule`

### Response Shape

```json
{
  "meta": {
    "projectId": "uuid",
    "rootTaskId": "uuid",
    "depth": "all",
    "maxDepthVisited": 6,
    "limit": 500,
    "truncated": false,
    "includeCompleted": true,
    "includeDeleted": false,
    "includeSuperseded": false,
    "includes": ["checklist", "counts", "progress", "status", "viewMeta", "permissions"],
    "generatedAt": "2026-07-28T10:15:30.000Z"
  },
  "summary": {
    "taskCount": 42,
    "descendantCount": 41,
    "leafCount": 18,
    "completedTaskCount": 12,
    "checklistItemCount": 96,
    "completedChecklistItemCount": 51,
    "branchedChecklistItemCount": 24,
    "openRequestCount": 5,
    "urgentRequestCount": 1,
    "rollupProgress": 57
  },
  "data": {
    "rootId": "uuid",
    "nodes": [],
    "edges": [],
    "flatChecklistItems": []
  }
}
```

### Node Contract

```json
{
  "id": "uuid",
  "taskCode": "P1.2.3",
  "wbsCode": "1.2.3",
  "parentTaskId": "uuid",
  "title": "Install kitchen backsplash",
  "scheduleType": "task",
  "track": "construction",
  "status": {
    "id": "uuid",
    "name": "In Progress",
    "key": "in-progress",
    "color": "#2563eb"
  },
  "progress": {
    "self": 45,
    "rollup": 62,
    "completed": false
  },
  "counts": {
    "childCount": 3,
    "descendantCount": 9,
    "checklistItemCount": 8,
    "completedChecklistItemCount": 4,
    "branchedChecklistItemCount": 2,
    "openRequestCount": 1
  },
  "assignees": [],
  "viewMeta": {
    "mindmap": {
      "x": 340,
      "y": 180,
      "collapsed": false
    }
  },
  "permissions": {
    "canView": true,
    "canEdit": true,
    "canBranchChecklistItem": true,
    "canCreateRequest": true
  }
}
```

### Edge Contract

Mindmap edges are structural, not schedule dependencies.

```json
{
  "id": "uuid:uuid",
  "type": "child-task",
  "sourceTaskId": "uuid",
  "targetTaskId": "uuid",
  "checklistItemId": "uuid",
  "checklistItemCode": "C3"
}
```

Allowed edge types:

- `child-task`: direct Task parent/child relation.
- `branched-checklist-item`: checklist item converted into child Task.
- `linked-task`: non-hierarchical cross-root relation when `include=linkedTasks`.
- `subject-of-review`: governance review link when `include=linkedTasks`.

### Flat Checklist Item Contract

Flat checklist items are not Task nodes. They appear beside Task nodes so the UI can show the same mixed checklist state as Kanban.

```json
{
  "id": "uuid",
  "taskId": "uuid",
  "itemCode": "C4",
  "text": "Confirm tile grout color",
  "completed": false,
  "orderIndex": 4,
  "checklistGroupId": "uuid",
  "branchedTaskId": null,
  "branchStatus": null,
  "completedAt": null,
  "completedByUserId": null
}
```

If `branchedTaskId` is present, the item should also be represented by a `branched-checklist-item` edge.

## Gantt Read Contract

### Endpoint

```http
GET /projects/:projectId/tasks/:taskId/gantt
```

This endpoint returns a schedule projection for the visible subtree under one Task. It extends the existing project-level activity schedule Gantt response by adding subtree scope, explicit schedule edges, milestone data, permissions, and view metadata.

The existing `GET /projects/:projectId/activity-schedule/gantt` endpoint should remain as the project-level chart.

### Query Parameters

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `from` | date | first visible schedule date | Start of visible timeline window. Snapped to the selected scale. |
| `periods` | integer | `36` | Number of visible time buckets. |
| `scale` | `day`, `week`, `month`, `quarter` | `week` | Timeline bucket scale. |
| `depth` | integer or `all` | `all` | Descendant levels included in rows. |
| `limit` | integer | `100` | Maximum rows returned for the current row window. |
| `cursor` | string | none | Optional row-window cursor for large subtrees. |
| `include` | CSV | `dependencies,milestones,criticalPath,viewMeta,permissions` | Optional expansions. |
| `includeSummaryRows` | boolean | `true` | Include phase/stage/summary rows. |
| `criticalOnly` | boolean | `false` | Return only critical rows. |
| `overdueOnly` | boolean | `false` | Return only overdue incomplete rows. |
| `track` | string | none | Filter by design, procurement, construction, governance, or configured task type/track. |
| `locationId` | uuid | none | Filter by task location scope. |
| `assigneeUserId` | uuid | none | Filter by assigned user. |
| `statusId` | uuid | none | Filter by project status. |
| `baselineId` | uuid | latest baseline | Include baseline comparison when baseline support is available. |

Allowed `include` values:

- `dependencies`
- `milestones`
- `criticalPath`
- `baseline`
- `viewMeta`
- `permissions`
- `assignees`
- `calendar`
- `checks`

### Response Shape

```json
{
  "meta": {
    "projectId": "uuid",
    "rootTaskId": "uuid",
    "fromDate": "2026-08-03",
    "scale": "week",
    "periods": 36,
    "timezone": "Africa/Kigali",
    "rowCursor": null,
    "nextCursor": null,
    "limit": 100,
    "truncated": false,
    "generatedAt": "2026-07-28T10:15:30.000Z"
  },
  "summary": {
    "rows": 74,
    "activities": 51,
    "milestones": 8,
    "started": 29,
    "complete": 18,
    "overdue": 6,
    "critical": 12,
    "progress": 48,
    "earliestStartDate": "2026-08-10",
    "latestFinishDate": "2027-02-15"
  },
  "data": {
    "buckets": [],
    "rows": [],
    "dependencies": [],
    "milestones": [],
    "criticalPath": []
  }
}
```

### Bucket Contract

```json
{
  "index": 0,
  "startDate": "2026-08-03",
  "endDate": "2026-08-09",
  "label": "Aug 3",
  "month": "Aug"
}
```

### Row Contract

```json
{
  "taskId": "uuid",
  "parentTaskId": "uuid",
  "taskCode": "P1.2.3",
  "wbsCode": "1.2.3",
  "wbsSortKey": "0001.0002.0003",
  "level": 3,
  "title": "Install kitchen backsplash",
  "scheduleType": "activity",
  "track": "construction",
  "startDate": "2026-08-17",
  "finishDate": "2026-08-21",
  "durationDays": 5,
  "progress": 45,
  "completed": false,
  "overdue": false,
  "isMilestone": false,
  "isCritical": true,
  "totalFloatDays": 0,
  "freeFloatDays": 0,
  "baseline": {
    "startDate": "2026-08-15",
    "finishDate": "2026-08-19",
    "varianceDays": 2
  },
  "bucketSpans": [
    {
      "bucketIndex": 2,
      "startOffset": 0.14,
      "endOffset": 0.71,
      "status": "active"
    }
  ],
  "viewMeta": {
    "gantt": {
      "barColor": "#2563eb",
      "collapsed": false
    }
  },
  "permissions": {
    "canView": true,
    "canEditSchedule": true,
    "canEditDependencies": true
  }
}
```

`bucketSpans` should be preferred over full per-bucket status arrays for large charts because it gives the frontend enough information to draw bars without returning hundreds of repeated empty cells.

### Dependency Contract

```json
{
  "id": "uuid",
  "sourceTaskId": "uuid",
  "targetTaskId": "uuid",
  "type": "FS",
  "lagDays": 0,
  "isCritical": true,
  "visible": true,
  "visibilityReason": null
}
```

Dependency direction:

- `sourceTaskId`: predecessor.
- `targetTaskId`: successor.

Allowed dependency types:

- `FS`: finish-to-start.
- `SS`: start-to-start.
- `FF`: finish-to-finish.
- `SF`: start-to-finish.

If one side of a dependency is outside the visible scope, return the edge only when requested and mark `visible=false` with `visibilityReason`, or omit it in the default chart response.

### Milestone Contract

```json
{
  "taskId": "uuid",
  "date": "2026-09-01",
  "title": "Permit approved",
  "track": "governance",
  "isCritical": true,
  "completed": false
}
```

## View Metadata Write Contract

### Endpoint

```http
PATCH /projects/:projectId/tasks/view-metadata
```

This endpoint updates layout metadata only. It must not mutate task title, status, schedule dates, progress, checklist state, dependencies, or ownership.

### Request

```json
{
  "viewType": "mindmap",
  "items": [
    {
      "taskId": "uuid",
      "meta": {
        "x": 120,
        "y": 300,
        "collapsed": false
      }
    }
  ]
}
```

For Gantt:

```json
{
  "viewType": "gantt",
  "items": [
    {
      "taskId": "uuid",
      "meta": {
        "barColor": "#2563eb",
        "collapsed": true
      }
    }
  ]
}
```

### Response

```json
{
  "meta": {
    "projectId": "uuid",
    "viewType": "mindmap",
    "updated": 1,
    "generatedAt": "2026-07-28T10:15:30.000Z"
  },
  "summary": {
    "accepted": 1,
    "rejected": 0
  },
  "data": {
    "items": [
      {
        "taskId": "uuid",
        "viewType": "mindmap",
        "meta": {
          "x": 120,
          "y": 300,
          "collapsed": false
        }
      }
    ]
  }
}
```

## Checks Contracts

### Mindmap Checks

```http
GET /projects/:projectId/tasks/:taskId/mindmap/checks
```

Checks should include:

- `orphan_task`
- `branch_missing_child_task`
- `child_missing_branch_source`
- `duplicate_wbs`
- `hidden_dependency_reference`
- `excessive_depth`
- `superseded_visible_in_active_view`

### Gantt Checks

```http
GET /projects/:projectId/tasks/:taskId/gantt/checks
```

Checks should include:

- `missing_schedule_row`
- `missing_duration`
- `dependency_cycle`
- `dependency_outside_scope`
- `negative_float`
- `milestone_non_zero_duration`
- `activity_zero_duration`
- `baseline_variance_unexplained`
- `manual_without_reason`

Response:

```json
{
  "meta": {
    "projectId": "uuid",
    "rootTaskId": "uuid",
    "generatedAt": "2026-07-28T10:15:30.000Z"
  },
  "summary": {
    "valid": false,
    "errorCount": 1,
    "warningCount": 2
  },
  "data": {
    "issues": [
      {
        "severity": "error",
        "code": "dependency_cycle",
        "message": "Activity schedule dependencies contain a cycle",
        "taskId": "uuid",
        "wbsCode": "1.2.3"
      }
    ]
  }
}
```

## Implementation Notes

### Suggested DTOs

- `TaskMindmapQueryDto`
- `TaskGanttQueryDto`
- `TaskProjectionIncludeDto` or shared include parser helper
- `BulkTaskViewMetadataDto`
- `TaskProjectionChecksQueryDto`

### Suggested Services

- `TaskMindmapProjectionService`
- `TaskGanttProjectionService` or a subtree-aware extension of `ActivityScheduleGanttService`
- `TaskProjectionChecksService`
- `TaskViewMetadataService`

### Existing Code To Reuse

- `TaskQueryService.getTaskTree` for recursive task loading and rollups.
- `ActivityScheduleGanttService.getGantt` for bucket generation and schedule row status.
- `TaskAuthService.applyTaskVisibilityScope` for row-level visibility.
- `TaskChecklistService.branchItem` semantics for branch edges.
- `TaskRelationsService` and `TaskDependency` for Gantt arrows.
- `task_view_metadata` for `mindmap` and `gantt` layout preferences.

### Compatibility

Do not remove these existing endpoints:

- `GET /projects/:projectId/tasks/:taskId/tree`
- `GET /projects/:projectId/activity-schedule/gantt`

The new endpoints are clearer, UI-ready contracts. Existing endpoints can either remain as lower-level APIs or eventually delegate to the same projection services with project-root defaults.
