# Project Task Access Model

This backend treats project membership and task assignment as separate concepts.

Project membership answers: "Can this user participate in this project?"
Task assignment answers: "Is this user responsible for this specific task?"

## Visibility Rules

Task visibility is resolved from the user's active project membership role:

| Project role permission | Result |
| --- | --- |
| `taskManagement.view = false` | User cannot view project tasks. |
| `taskManagement.view = true` and `viewScope = 'all'` | User can view every task and subtask in the project. |
| `taskManagement.view = true` and `viewScope = 'assigned'` | User can view only tasks they created, are assigned to, or report to. |

Project creator and workspace admin remain privileged paths for full task visibility.

Watchers are notification subscribers. Being a watcher does not grant assigned-only task visibility unless product requirements explicitly change that rule.

## Product Flow

To let a user see all tasks in a project, add or invite them as a project member with a project role whose `taskManagement.viewScope` is `'all'`.

To restrict a user to only their work, add or invite them with a project role whose `taskManagement.viewScope` is `'assigned'`.

Task assignment should not be used as the main way to grant project-wide access. It should represent direct responsibility for a task or subtask.

## Default Role Intent

Current default project roles follow this model:

| Role | Task view scope | Intent |
| --- | --- | --- |
| Owner | `all` | Full project control. |
| Manager | `all` | Project management without task deletion. |
| Contributor | `all` | Can create/update work and see project context. |
| Reviewer | `all` | Can review/update work with full task context. |
| Viewer | `assigned` | Read-only access limited to relevant assigned/reportee work. |

## Backend Implementation Target

All task list, task detail, schedule, Gantt, material/resource report, and change request visibility checks should honor the same rule:

```ts
taskManagement.view === true && taskManagement.viewScope === 'all'
```

When that is true for an active project membership role, the member can view all project tasks. Otherwise, assigned-only visibility filters apply.
