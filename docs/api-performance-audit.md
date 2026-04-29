# API Performance Audit — ArchKalinga Backend v1.2

**Date:** 2026-04-29  
**Scope:** Project-wide  
**Complaint:** "Create project" and other mutations take 10+ seconds  
**Target:** All endpoints under 1 second  

---

## Executive Summary

The audit found **4 critical bottlenecks** that alone account for 7–16 seconds on the "create project" flow, plus several high/medium issues that add 300–600 ms across all endpoints. Every bottleneck is fixable with targeted code changes — no architectural overhaul needed.

| # | Issue | Severity | Est. Impact |
|---|-------|----------|-------------|
| 1 | Unbounded activity log load in `loadFull()` | **CRITICAL** | 2–4 s |
| 2 | `createProject` calls `loadFull()` after seeding N tasks | **CRITICAL** | 3–5 s |
| 3 | Serial INSERT per task during template seeding | **CRITICAL** | 2–3 s |
| 4 | Missing DB indexes on all FK columns | **CRITICAL** | 1–2 s |
| 5 | `seedDefaults()` runs 4 repo.saves sequentially | **HIGH** | 300–500 ms |
| 6 | `ensureDefaultProjectRoles()` saves roles one-by-one in a loop | **HIGH** | 50–100 ms |
| 7 | `WorkspaceGuard` loads full `workspace` relation on every request | **HIGH** | 100–200 ms |
| 8 | `ProjectPermissionGuard` DB call on every project endpoint | **MEDIUM** | 50–150 ms |
| 9 | `getNextSeedRank()` fires a DB query per task during seeding | **MEDIUM** | 50–100 ms per task |

**Cumulative worst-case on "create project":** 8–16 seconds  
**After all fixes:** estimated 200–600 ms  

---

## CRITICAL Issues

### 1. Unbounded Activity Log Load in `loadFull()`

**File:** `src/projects/projects.service.ts` — `loadFull()` (line ~434)

```typescript
// Current — loads every activity log row ever written for this project
const project = await this.projectRepo.findOne({
  where: { id: projectId, workspaceId },
  relations: [
    'activityLogs',        // ← no LIMIT
    'activityLogs.user',   // ← full user record for every log
  ],
  order: { activityLogs: { createdAt: 'DESC' } },
});
```

After creating a project from a 50-task template, the project immediately has **101 activity log rows** (1 project-created + 2×50 task-seeded). `loadFull()` loads all of them with a JOIN to users. On larger templates this grows linearly.

**Fix:** Cap activity logs at 20 most-recent, loaded in a separate query.

```typescript
private async loadFull(projectId: string, workspaceId: string): Promise<Project> {
  const project = await this.projectRepo.findOne({
    where: { id: projectId, workspaceId },
    relations: [
      'template',
      'projectRoles',
      'memberships',
      'memberships.user',
      'memberships.projectRole',
      'invites',
      'invites.projectRole',
      'invites.inviteeUser',
    ],
  });
  if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);

  // Load only the 20 most recent activity logs separately (avoids unbounded JOIN)
  project.activityLogs = await this.projectActivityLogRepo.find({
    where: { projectId },
    relations: ['user'],
    order: { createdAt: 'DESC' },
    take: 20,
  });

  return project;
}
```

---

### 2. `createProject` Calls `loadFull()` Immediately After Seeding Tasks

**File:** `src/projects/projects.service.ts` — `createProject()` (line ~567)

```typescript
// Current — after 2 transactions that create N tasks + 2N activity logs,
// we immediately load them all back
return this.toSerializer(await this.loadFull(project.id, workspaceId));
```

This is the worst compound bottleneck: the transaction seeds N task activity logs, then `loadFull()` immediately fetches them all back. Even with fix #1, this is wasteful since the caller (POST /projects) only needs the project summary, not the full activity log.

**Fix:** Return a lightweight serialization from `createProject`. Activity logs can be fetched on-demand by `getProject`.

```typescript
// After both transactions complete, load only what the response needs
private async loadForCreate(projectId: string, workspaceId: string): Promise<Project> {
  const project = await this.projectRepo.findOne({
    where: { id: projectId, workspaceId },
    relations: [
      'template',
      'projectRoles',
      'memberships',
      'memberships.user',
      'memberships.projectRole',
    ],
  });
  if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
  project.activityLogs = [];   // not needed in creation response
  project.invites = [];
  return project;
}

// In createProject():
return this.toSerializer(await this.loadForCreate(project.id, workspaceId));
```

---

### 3. Serial INSERT per Task During Template Seeding

**File:** `src/projects/projects.service.ts` — `logSeededTaskActivity()` (line ~299)

For each template task, the code fires **two separate `manager.save()` calls** — one for `TaskActivityLog`, one for `ProjectActivityLog`. These execute serially inside a loop:

```
Task 1 created → INSERT task_activity_log → INSERT project_activity_log
Task 2 created → INSERT task_activity_log → INSERT project_activity_log
...
Task N created → INSERT task_activity_log → INSERT project_activity_log
```

For a 50-task template: **100 round-trips to the database** inside the transaction.  
For a 100-task template: **200 round-trips**.

**Fix:** Collect all log objects into arrays and batch-save once after the loop.

```typescript
// In seedProjectTasksFromTemplate — accumulate logs
const taskLogs: TaskActivityLog[] = [];
const projectLogs: ProjectActivityLog[] = [];

// Pass arrays down to createProjectTaskFromTemplate
for (const rootTask of templateTree) {
  createdCount += await this.createProjectTaskFromTemplate(
    manager, project, actorUser, rootTask,
    defaultStatus.id, defaultTaskType.id,
    undefined,
    taskLogs, projectLogs,   // ← new params
  );
}

// Single batch INSERT for all logs
if (taskLogs.length > 0)    await manager.save(TaskActivityLog, taskLogs);
if (projectLogs.length > 0) await manager.save(ProjectActivityLog, projectLogs);
```

Also applies to `getNextSeedRank()` — see issue #9 below.

---

### 4. Missing Database Indexes on All FK Columns

**Files:** Entity definitions across `src/projects/entities/`, `src/tasks/entities/`, `src/workspaces/entities/`

The following frequently-queried columns have no index. PostgreSQL must do a full sequential scan of the table for every lookup:

| Table | Column | Used in |
|-------|--------|---------|
| `projects` | `workspace_id` | Every project list/lookup |
| `projects` | `template_id` | Template validation |
| `project_memberships` | `project_id` | Every project access check |
| `project_memberships` | `user_id` | Every project permission guard |
| `project_memberships` | `project_role_id` | Role resolution |
| `tasks` | `project_id` | Every task list/lookup |
| `tasks` | `parent_task_id` | Subtask hierarchy queries |
| `tasks` | `status_id` | Kanban column grouping |
| `workspace_members` | `workspace_id` | **Every authenticated request** |
| `workspace_members` | `user_id` | **Every authenticated request** |
| `project_activity_logs` | `project_id` | Activity log queries |
| `task_activity_logs` | `task_id` | Task timeline queries |

With small datasets, this is not obvious. With real data (hundreds of projects, thousands of tasks), each unindexed lookup becomes a full table scan costing 100–500 ms each.

**Fix:** Create a migration (see `src/migrations/` — add `AddPerformanceIndexes`):

```sql
CREATE INDEX IF NOT EXISTS idx_projects_workspace_id             ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_template_id              ON projects(template_id);
CREATE INDEX IF NOT EXISTS idx_project_memberships_project_id    ON project_memberships(project_id);
CREATE INDEX IF NOT EXISTS idx_project_memberships_user_id       ON project_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_project_memberships_project_role  ON project_memberships(project_role_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id                  ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id              ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status_id                   ON tasks(status_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id    ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id         ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_activity_logs_project_id  ON project_activity_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_logs_task_id        ON task_activity_logs(task_id);
```

---

## HIGH Priority Issues

### 5. `seedDefaults()` Runs 4 Repo Saves Sequentially

**File:** `src/projects/project-config.service.ts` — `seedDefaults()` (line ~141)

The four seed calls are `await`-ed one after another:

```typescript
await this.statusRepo.save([...5 statuses]);
await this.priorityRepo.save([...4 priorities]);
await this.severityRepo.save([...3 severities]);
await this.taskTypeRepo.save([...5 task types]);
```

Each is a separate round-trip to the database. They are independent and can run concurrently.

**Fix:**

```typescript
await Promise.all([
  this.statusRepo.save(statusSeeds.map(...)),
  this.priorityRepo.save(prioritySeeds.map(...)),
  this.severityRepo.save(severitySeeds.map(...)),
  this.taskTypeRepo.save(taskTypeSeeds.map(...)),
]);
```

---

### 6. `ensureDefaultProjectRoles()` Saves 5 Roles Serially

**File:** `src/projects/projects.service.ts` — `ensureDefaultProjectRoles()` (line ~271)

```typescript
for (const def of DEFAULT_PROJECT_ROLE_DEFINITIONS) {
  if (!roleMap.has(def.slug)) {
    const created = await manager.save(manager.create(ProjectRole, { ... }));
    //              ^^^^ awaited inside loop — 5 sequential INSERTs
    roleMap.set(created.slug, created);
  }
}
```

**Fix:** Build all missing roles as entities and batch-save them:

```typescript
const toCreate = DEFAULT_PROJECT_ROLE_DEFINITIONS
  .filter(def => !roleMap.has(def.slug))
  .map(def => manager.create(ProjectRole, {
    project, projectId: project.id,
    name: def.name, slug: def.slug,
    status: true, isSystem: def.isSystem,
    isProtected: def.isProtected, permissions: def.permissions,
  }));

if (toCreate.length > 0) {
  const saved = await manager.save(toCreate);   // single round-trip
  saved.forEach(role => roleMap.set(role.slug, role));
}
```

---

### 7. `WorkspaceGuard` Loads the Full `workspace` Relation on Every Request

**File:** `src/workspaces/guards/workspace.guard.ts`

```typescript
const member = await this.memberRepo.findOne({
  where: { workspaceId, userId },
  relations: ['workspaceRole', 'workspace'],   // 'workspace' is never used
});
```

The guard only checks `member.workspaceRole.permissions`. The full `workspace` record is loaded but never read — it's pure wasted I/O on **every authenticated request**.

**Fix:** Remove `'workspace'` from the relations array.

---

## MEDIUM Priority Issues

### 8. `ProjectPermissionGuard` Makes an Uncached DB Call on Every Project Endpoint

**File:** `src/auth/guards/project-permission.guard.ts`

A membership lookup hits the database on every request to any project-scoped endpoint: get project, update project, list tasks, create task, etc. This is inherent to the guard pattern but can be mitigated by caching the result in the request context so subsequent guards/services in the same request don't repeat it.

**Fix (short-term):** Attach the loaded `membership` to `request.projectMembership` after the first load so downstream services can reuse it without a second query.

**Fix (long-term):** Add a short-lived Redis cache (5 min TTL) keyed on `userId:projectId`. Invalidate on membership change.

---

### 9. `getNextSeedRank()` Fires a DB Query Per Task

**File:** `src/projects/projects.service.ts` — `getNextSeedRank()` (line ~247)

During template task seeding, this method queries for the last sibling's rank on every task creation. For 100 tasks in a flat template, that's **100 extra SELECT queries** per project creation.

**Fix:** Pre-compute rank in memory during the seeding loop. Since seeding is deterministic (one task at a time, ordered), you can track the last rank in a local `Map<parentId, bigint>` and increment without hitting the database:

```typescript
// In seedProjectTasksFromTemplate
const rankCounters = new Map<string | null, bigint>();  // parentId -> current rank

function nextRank(parentId: string | null): string {
  const current = rankCounters.get(parentId) ?? 0n;
  const next = current + RANK_STEP;
  rankCounters.set(parentId, next);
  return formatRankValue(next);
}
```

---

## LOW Priority Issues

### 10. Audit Log Listing Loads Full User Records

**File:** `src/common/services/audit-log.service.ts`

The audit log list loads the full `actor` User entity (all columns) when only name fields are needed. Add a `select` clause to limit which user fields are fetched.

### 11. `workspaceRepo.findOneOrFail` Called Before Every Project Creation

**File:** `src/projects/projects.service.ts` — `createProject()` (line ~476)

```typescript
const workspaceRecord = await this.workspaceRepo.findOneOrFail({ where: { id: workspaceId } });
```

The `workspaceId` comes from the validated JWT — it's already confirmed to exist by the time `WorkspaceGuard` runs. This extra SELECT is redundant. Pass the workspace from the guard context instead.

---

## Recommended Fix Order

Apply in this sequence for maximum immediate impact:

1. **Issue #4 — Add DB indexes** (migration, 0 code risk, instant improvement on all queries)
2. **Issue #1 — Cap activity logs in `loadFull()`** (2–4 s improvement)
3. **Issue #2 — Lean response from `createProject`** (3–5 s improvement)
4. **Issue #3 — Batch task activity log inserts** (2–3 s improvement)
5. **Issue #5 — Parallelize `seedDefaults()`** (300–500 ms)
6. **Issue #6 — Batch role saves** (50–100 ms)
7. **Issue #7 — Remove unused relation in WorkspaceGuard** (100–200 ms per request)
8. **Issue #9 — In-memory rank counter during seeding** (reduces seeding query count by 50–100%)
9. **Issue #8 — Cache ProjectPermissionGuard result in request context** (50–150 ms)

---

## Quick Wins (Apply in 5 Minutes)

These changes are one-liners with zero risk:

```typescript
// 1. workspace.guard.ts — remove 'workspace' from relations
relations: ['workspaceRole']   // was ['workspaceRole', 'workspace']

// 2. project-config.service.ts — parallelize seedDefaults
await Promise.all([
  this.statusRepo.save(...),
  this.priorityRepo.save(...),
  this.severityRepo.save(...),
  this.taskTypeRepo.save(...),
]);

// 3. projects.service.ts — cap loadFull activity logs
take: 20
```

---

## Expected Outcome After All Fixes

| Endpoint | Before | After |
|----------|--------|-------|
| `POST /projects` | 10–16 s | ~400–700 ms |
| `GET /projects/:id` | 3–5 s | ~80–150 ms |
| `GET /projects` (list) | 1–3 s | ~50–100 ms |
| Any project-scoped endpoint | +200–500 ms guard overhead | +30–80 ms |
