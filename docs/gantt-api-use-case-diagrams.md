# Gantt API Use Case Diagrams

These diagrams describe the Gantt and activity schedule API surface exposed by `TasksController`.

## Actors

| Actor | Meaning |
| --- | --- |
| Project viewer | Authenticated project member with `taskManagement.view`. |
| Schedule editor | Project member with `taskManagement.update`. |
| Planner / PM | Schedule editor responsible for dates, dependencies, WBS, imports, and recalculation. |
| Gantt UI | Frontend chart/table consuming project task and activity schedule APIs. |
| Scheduler service | Backend service that builds Gantt rows, buckets, CPM fields, checks, and explanations. |

## Gantt Read Use Cases

```mermaid
flowchart LR
  viewer[Project viewer]
  ui[Gantt UI]
  service[Scheduler service]

  subgraph api[Gantt read APIs]
    gantt((View Gantt chart))
    summary((View schedule summary))
    tracker((View progress tracker))
    checks((Review schedule checks))
    critical((Review critical path))
    explanation((Inspect task schedule explanation))
    calendar((View working calendar))
    tasks((List task rows and task details))
  end

  viewer --> ui
  ui --> gantt
  ui --> summary
  ui --> tracker
  ui --> checks
  ui --> critical
  ui --> explanation
  ui --> calendar
  ui --> tasks

  gantt --> service
  summary --> service
  tracker --> service
  checks --> service
  critical --> service
  explanation --> service
```

## Gantt Maintenance Use Cases

```mermaid
flowchart LR
  editor[Schedule editor]
  planner[Planner / PM]
  ui[Gantt UI]
  service[Scheduler service]

  subgraph api[Gantt write APIs]
    createTask((Create schedule task))
    updateTask((Edit task dates and progress))
    bulkUpdate((Bulk update timeline rows))
    moveTask((Move or reparent WBS row))
    addDependency((Add dependency))
    updateDependency((Update dependency type or lag))
    deleteDependency((Delete dependency))
    calendar((Maintain working calendar))
    exceptions((Maintain calendar exceptions))
    importSchedule((Import WBS/activity schedule workbook))
    recalculate((Recalculate CPM schedule))
  end

  editor --> ui
  planner --> ui
  ui --> createTask
  ui --> updateTask
  ui --> bulkUpdate
  ui --> moveTask
  ui --> addDependency
  ui --> updateDependency
  ui --> deleteDependency
  ui --> calendar
  ui --> exceptions
  ui --> importSchedule
  ui --> recalculate

  addDependency --> recalculate
  updateDependency --> recalculate
  deleteDependency --> recalculate
  calendar --> recalculate
  exceptions --> recalculate
  importSchedule --> recalculate
  recalculate --> service
```

## Permission And Audit Boundary

```mermaid
flowchart TD
  user[Authenticated user] --> guard{ProjectPermissionGuard}

  guard -->|taskManagement.view| read[Read Gantt/activity schedule data]
  guard -->|taskManagement.update| write[Mutate schedule tasks, dependencies, calendar, imports]
  guard -->|missing permission| denied[403 insufficient project permission]

  read --> scope{Task view scope}
  scope -->|all| allRows[Return all visible project schedule rows]
  scope -->|assigned| assignedRows[Return assigned/created/reportee-visible rows]

  write --> audit[LogActivity interceptor]
  audit --> service[TasksService verifies project permission]
  service --> domain[Task, schedule, dependency, calendar services]
```

## Endpoint Map

| Use case | Method and path | Permission |
| --- | --- | --- |
| View Gantt chart | `GET /projects/:projectId/activity-schedule/gantt` | `taskManagement.view` |
| View schedule summary | `GET /projects/:projectId/activity-schedule/summary` | `taskManagement.view` |
| View progress tracker | `GET /projects/:projectId/activity-schedule/progress-tracker` | `taskManagement.view` |
| Review schedule checks | `GET /projects/:projectId/activity-schedule/checks` | `taskManagement.view` |
| Review critical path | `GET /projects/:projectId/activity-schedule/critical-path` | `taskManagement.view` |
| Export critical path | `GET /projects/:projectId/activity-schedule/critical-path/export` | `taskManagement.view` |
| Inspect task explanation | `GET /projects/:projectId/activity-schedule/explanations/:taskId` | `taskManagement.view` |
| View working calendar | `GET /projects/:projectId/activity-schedule/calendar` | `taskManagement.view` |
| List calendar exceptions | `GET /projects/:projectId/activity-schedule/calendar/exceptions` | `taskManagement.view` |
| List backing task rows | `GET /projects/:projectId/tasks` | `taskManagement.view` |
| Create schedule task | `POST /projects/:projectId/tasks` | `taskManagement.create` |
| Edit task dates/progress/Gantt metadata | `PATCH /projects/:projectId/tasks/:taskId` | `taskManagement.update` |
| Bulk timeline edits | `PATCH /projects/:projectId/tasks/bulk` | `taskManagement.update` |
| Move or reparent WBS row | `PATCH /projects/:projectId/tasks/:taskId/move` | `taskManagement.update` |
| Add dependency | `POST /projects/:projectId/tasks/:taskId/dependencies` | `taskManagement.update` |
| Update dependency | `PATCH /projects/:projectId/tasks/:taskId/dependencies/:depId` | `taskManagement.update` |
| Delete dependency | `DELETE /projects/:projectId/tasks/:taskId/dependencies/:depId` | `taskManagement.update` |
| Maintain working calendar | `PATCH /projects/:projectId/activity-schedule/calendar` | `taskManagement.update` |
| Create calendar exception | `POST /projects/:projectId/activity-schedule/calendar/exceptions` | `taskManagement.update` |
| Update calendar exception | `PATCH /projects/:projectId/activity-schedule/calendar/exceptions/:exceptionId` | `taskManagement.update` |
| Delete calendar exception | `DELETE /projects/:projectId/activity-schedule/calendar/exceptions/:exceptionId` | `taskManagement.update` |
| Import WBS/activity schedule workbook | `POST /projects/:projectId/activity-schedule/import` | `taskManagement.update` |
| Recalculate CPM schedule | `POST /projects/:projectId/activity-schedule/recalculate` | `taskManagement.update` |

## Primary User Journeys

```mermaid
flowchart TD
  open[Open Gantt tab] --> fetch[Fetch Gantt rows, summary, checks, calendar]
  fetch --> render[Render WBS rows, timeline buckets, critical path, progress]
  render --> inspect{User action}
  inspect -->|click row| detail[Open task details]
  inspect -->|drag bar| update[Patch task dates or bulk update rows]
  inspect -->|link tasks| dependency[Create or update dependency]
  inspect -->|change calendar| calendar[Update calendar or exception]
  update --> recalc[Recalculate schedule]
  dependency --> recalc
  calendar --> recalc
  recalc --> refresh[Refresh Gantt rows and checks]
  refresh --> render
```
