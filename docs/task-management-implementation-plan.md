# Task Management — Implementation Plan

## Purpose

This document is the authoritative handoff for implementing Workstream 4 (Task Management) in the ArchKalinga NestJS backend. It covers entity design, migration plan, API contracts, DTOs, service logic, serializers, and delivery phases.

The core design principle: **one canonical `tasks` domain, three view projections.** Kanban, Mindmap, and Gantt all read from and write to the same task records. There are no separate "kanban tasks", "mindmap nodes", or "gantt items".

---

## Module Structure

Create `src/tasks/` with the following layout:

```
src/tasks/
├── tasks.module.ts
├── tasks.controller.ts
├── tasks.service.ts
│
├── entities/
│   ├── index.ts
│   ├── task.entity.ts
│   ├── task-assignee.entity.ts
│   ├── task-checklist-item.entity.ts
│   ├── task-comment.entity.ts
│   ├── task-dependency.entity.ts
│   ├── task-view-metadata.entity.ts
│   └── task-activity-log.entity.ts
│
├── workflow/
│   ├── index.ts
│   └── workflow-column.entity.ts
│
├── dtos/
│   ├── index.ts
│   ├── create-task.dto.ts
│   ├── update-task.dto.ts
│   ├── task-filters.dto.ts
│   ├── move-task.dto.ts
│   ├── bulk-update-tasks.dto.ts
│   ├── add-comment.dto.ts
│   ├── update-comment.dto.ts
│   ├── add-checklist-item.dto.ts
│   ├── update-checklist-item.dto.ts
│   ├── add-dependency.dto.ts
│   ├── create-workflow-column.dto.ts
│   └── update-workflow-column.dto.ts
│
├── serializers/
│   ├── index.ts
│   ├── task.serializer.ts
│   ├── task-list-item.serializer.ts
│   └── workflow-column.serializer.ts
│
└── messages/
    ├── index.ts
    ├── error.ts
    └── success.ts
```

---

## Database Schema

### Key Design Decisions

- Every entity extends `AppBaseEntity` — inheriting `pkid` (auto-increment), `id` (UUID), `version`, `createdAt`, `updatedAt`.
- Soft-delete uses `deletedAt: Date | null` on `tasks` and `task_comments`.
- All task queries must always filter `WHERE deleted_at IS NULL`.
- `rank` is a fractional-indexing string (e.g. `"a0"`, `"a1"`, `"Zz"`) for orderless reordering without shifting all rows.
- `workflow_columns` are project-scoped. They define the kanban board structure. `tasks.workflowColumnId` links to a column.
- `task_view_metadata` stores per-view layout data (mindmap x/y, gantt bar color) as JSONB. It is never authoritative for task content.
- `task_dependencies` stores directed edges: `taskId → dependsOnTaskId` (successor → predecessor). Cycle detection must run before insert.

---

### Entity 1: `task.entity.ts`

```typescript
// Enums
export enum TaskStatus {
  TODO        = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW   = 'IN_REVIEW',
  DONE        = 'DONE',
  BLOCKED     = 'BLOCKED',
}

export enum TaskPriority {
  LOW    = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH   = 'HIGH',
  URGENT = 'URGENT',
}

// Table: tasks
@Entity('tasks')
export class Task extends AppBaseEntity {
  // ── Core content ────────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.TODO })
  status: TaskStatus;

  @Column({ type: 'enum', enum: TaskPriority, nullable: true })
  priority: TaskPriority | null;

  // ── Scheduling (Gantt) ──────────────────────────────────────────────────────
  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  @Column({ type: 'smallint', nullable: true })     // 0–100
  progress: number | null;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  // ── Kanban ──────────────────────────────────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  workflowColumnId: string | null;

  @ManyToOne(() => WorkflowColumn, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'workflow_column_id' })
  workflowColumn: WorkflowColumn | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  rank: string | null;                               // fractional-index string

  // ── Hierarchy (Mindmap / Subtasks) ──────────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  parentTaskId: string | null;

  @ManyToOne(() => Task, (t) => t.children, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_task_id' })
  parent: Task | null;

  @OneToMany(() => Task, (t) => t.parent)
  children: Task[];

  // ── Ownership ───────────────────────────────────────────────────────────────
  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid' })
  createdByUserId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User;

  // ── Soft delete ─────────────────────────────────────────────────────────────
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // ── Relations (loaded on demand) ────────────────────────────────────────────
  @OneToMany(() => TaskAssignee, (a) => a.task)
  assignees: TaskAssignee[];

  @OneToMany(() => TaskChecklistItem, (c) => c.task)
  checklistItems: TaskChecklistItem[];

  @OneToMany(() => TaskComment, (c) => c.task)
  comments: TaskComment[];

  @OneToMany(() => TaskDependency, (d) => d.task)
  dependencyEdges: TaskDependency[];

  @OneToMany(() => TaskViewMetadata, (m) => m.task)
  viewMetadataEntries: TaskViewMetadata[];
}
```

---

### Entity 2: `workflow-column.entity.ts`

```typescript
// Table: workflow_columns
@Entity('workflow_columns')
export class WorkflowColumn extends AppBaseEntity {
  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  statusKey: string | null;      // maps to canonical TaskStatus e.g. 'IN_PROGRESS'

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  @Column({ type: 'int', nullable: true })
  wipLimit: number | null;

  @OneToMany(() => Task, (t) => t.workflowColumn)
  tasks: Task[];
}
```

---

### Entity 3: `task-assignee.entity.ts`

```typescript
export enum AssignmentRole {
  OWNER       = 'OWNER',
  CONTRIBUTOR = 'CONTRIBUTOR',
  REVIEWER    = 'REVIEWER',
}

// Table: task_assignees
@Entity('task_assignees')
export class TaskAssignee extends AppBaseEntity {
  @Column({ type: 'uuid' })
  taskId: string;

  @ManyToOne(() => Task, (t) => t.assignees, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: AssignmentRole, default: AssignmentRole.CONTRIBUTOR })
  assignmentRole: AssignmentRole;
}
```

Unique constraint: `(task_id, user_id)`.

---

### Entity 4: `task-checklist-item.entity.ts`

```typescript
// Table: task_checklist_items
@Entity('task_checklist_items')
export class TaskChecklistItem extends AppBaseEntity {
  @Column({ type: 'uuid' })
  taskId: string;

  @ManyToOne(() => Task, (t) => t.checklistItems, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'varchar', length: 500 })
  text: string;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  @Column({ type: 'uuid', nullable: true })
  completedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
```

---

### Entity 5: `task-comment.entity.ts`

```typescript
// Table: task_comments
@Entity('task_comments')
export class TaskComment extends AppBaseEntity {
  @Column({ type: 'uuid' })
  taskId: string;

  @ManyToOne(() => Task, (t) => t.comments, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid' })
  authorUserId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_user_id' })
  authorUser: User;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'uuid', nullable: true })
  parentCommentId: string | null;       // for threaded replies (optional phase 2)

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;               // soft delete
}
```

---

### Entity 6: `task-dependency.entity.ts`

```typescript
export enum DependencyType {
  FINISH_TO_START  = 'FS',   // predecessor must finish before successor starts (default)
  START_TO_START   = 'SS',
  FINISH_TO_FINISH = 'FF',
  START_TO_FINISH  = 'SF',
}

// Table: task_dependencies
// Directed edge: taskId (successor) depends on dependsOnTaskId (predecessor)
@Entity('task_dependencies')
export class TaskDependency extends AppBaseEntity {
  @Column({ type: 'uuid' })
  taskId: string;                          // successor

  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'uuid' })
  dependsOnTaskId: string;                 // predecessor

  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'depends_on_task_id' })
  dependsOnTask: Task;

  @Column({ type: 'enum', enum: DependencyType, default: DependencyType.FINISH_TO_START })
  dependencyType: DependencyType;

  @Column({ type: 'int', nullable: true })
  lagDays: number | null;
}
```

Unique constraint: `(task_id, depends_on_task_id)`.
Rule: `task_id !== depends_on_task_id` (no self-dependency). Both tasks must belong to the same project.

---

### Entity 7: `task-view-metadata.entity.ts`

```typescript
export enum ViewType {
  MINDMAP = 'mindmap',
  GANTT   = 'gantt',
}

// Table: task_view_metadata
@Entity('task_view_metadata')
export class TaskViewMetadata extends AppBaseEntity {
  @Column({ type: 'uuid' })
  taskId: string;

  @ManyToOne(() => Task, (t) => t.viewMetadataEntries, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ type: 'enum', enum: ViewType })
  viewType: ViewType;

  @Column({ type: 'jsonb', default: {} })
  metaJson: Record<string, unknown>;     // { x, y, collapsed } for mindmap; { barColor } for gantt
}
```

Unique constraint: `(task_id, view_type)`.

---

### Entity 8: `task-activity-log.entity.ts`

```typescript
export enum TaskActionType {
  TASK_CREATED    = 'TASK_CREATED',
  TASK_UPDATED    = 'TASK_UPDATED',
  TASK_MOVED      = 'TASK_MOVED',
  TASK_DELETED    = 'TASK_DELETED',
  TASK_ASSIGNED   = 'TASK_ASSIGNED',
  TASK_UNASSIGNED = 'TASK_UNASSIGNED',
  COMMENT_ADDED   = 'COMMENT_ADDED',
  STATUS_CHANGED  = 'STATUS_CHANGED',
  CHECKLIST_UPDATED = 'CHECKLIST_UPDATED',
  DEPENDENCY_ADDED = 'DEPENDENCY_ADDED',
}

// Table: task_activity_logs
@Entity('task_activity_logs')
export class TaskActivityLog extends AppBaseEntity {
  @Column({ type: 'uuid' })
  taskId: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: 'uuid' })
  actorUserId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: User;

  @Column({ type: 'enum', enum: TaskActionType })
  actionType: TaskActionType;

  @Column({ type: 'jsonb', nullable: true })
  actionMeta: Record<string, unknown> | null;
}
```

---

## Migration Plan

Create one migration file for the entire tasks domain:

**File:** `src/migrations/<timestamp>-create-tasks.ts`

### SQL outline

```sql
-- Workflow columns (must precede tasks FK)
CREATE TABLE workflow_columns (
  pkid          SERIAL PRIMARY KEY,
  id            UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version       INT NOT NULL DEFAULT 1,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  status_key    VARCHAR(100),
  order_index   INT NOT NULL DEFAULT 0,
  wip_limit     INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Core tasks table
CREATE TABLE tasks (
  pkid                 SERIAL PRIMARY KEY,
  id                   UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version              INT NOT NULL DEFAULT 1,
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id       UUID REFERENCES tasks(id) ON DELETE CASCADE,
  workflow_column_id   UUID REFERENCES workflow_columns(id) ON DELETE SET NULL,
  created_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title                VARCHAR(500) NOT NULL,
  description          TEXT,
  status               VARCHAR(50) NOT NULL DEFAULT 'TODO',
  priority             VARCHAR(50),
  start_date           DATE,
  end_date             DATE,
  progress             SMALLINT CHECK (progress BETWEEN 0 AND 100),
  completed            BOOLEAN NOT NULL DEFAULT FALSE,
  rank                 VARCHAR(50),
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assignees
CREATE TABLE task_assignees (
  pkid              SERIAL PRIMARY KEY,
  id                UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version           INT NOT NULL DEFAULT 1,
  task_id           UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_role   VARCHAR(50) NOT NULL DEFAULT 'CONTRIBUTOR',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id)
);

-- Checklist items
CREATE TABLE task_checklist_items (
  pkid                  SERIAL PRIMARY KEY,
  id                    UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version               INT NOT NULL DEFAULT 1,
  task_id               UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text                  VARCHAR(500) NOT NULL,
  completed             BOOLEAN NOT NULL DEFAULT FALSE,
  order_index           INT NOT NULL DEFAULT 0,
  completed_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comments
CREATE TABLE task_comments (
  pkid               SERIAL PRIMARY KEY,
  id                 UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version            INT NOT NULL DEFAULT 1,
  task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body               TEXT NOT NULL,
  parent_comment_id  UUID REFERENCES task_comments(id) ON DELETE SET NULL,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dependencies (directed graph edges)
CREATE TABLE task_dependencies (
  pkid                SERIAL PRIMARY KEY,
  id                  UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version             INT NOT NULL DEFAULT 1,
  task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type     VARCHAR(10) NOT NULL DEFAULT 'FS',
  lag_days            INT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

-- View metadata (mindmap positions, gantt colors, etc.)
CREATE TABLE task_view_metadata (
  pkid        SERIAL PRIMARY KEY,
  id          UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version     INT NOT NULL DEFAULT 1,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  view_type   VARCHAR(50) NOT NULL,
  meta_json   JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, view_type)
);

-- Activity / audit log
CREATE TABLE task_activity_logs (
  pkid            SERIAL PRIMARY KEY,
  id              UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version         INT NOT NULL DEFAULT 1,
  task_id         UUID NOT NULL,
  project_id      UUID NOT NULL,
  actor_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action_type     VARCHAR(100) NOT NULL,
  action_meta     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recommended indexes
CREATE INDEX idx_tasks_project_parent_deleted   ON tasks (project_id, parent_task_id, deleted_at);
CREATE INDEX idx_tasks_project_column_rank      ON tasks (project_id, workflow_column_id, rank, deleted_at);
CREATE INDEX idx_tasks_project_dates_deleted    ON tasks (project_id, start_date, end_date, deleted_at);
CREATE INDEX idx_task_assignees_task_user       ON task_assignees (task_id, user_id);
CREATE INDEX idx_task_dependencies_task         ON task_dependencies (task_id, depends_on_task_id);
CREATE INDEX idx_task_comments_task_created     ON task_comments (task_id, created_at);
CREATE INDEX idx_task_activity_logs_task        ON task_activity_logs (task_id, created_at DESC);
CREATE INDEX idx_task_activity_logs_project     ON task_activity_logs (project_id, created_at DESC);
CREATE INDEX idx_workflow_columns_project_order ON workflow_columns (project_id, order_index);
```

---

## API Endpoints

All routes are nested under `projects/:projectId`. The controller prefix is `projects/:projectId`.

### Authorization rules (applies to all task endpoints)

- `JwtAuthGuard` — must be authenticated.
- `ProjectPermissionGuard` + `RequireProjectPermission('taskManagement', <action>)` — project-role gate.
- **Service-level verification** — task service revalidates that the caller's active project membership grants the required `taskManagement` action before mutating or returning project task data.

---

### Workflow Columns (prerequisite for Kanban)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/projects/:projectId/columns` | `taskManagement.view` | List all columns for project |
| `POST` | `/projects/:projectId/columns` | `taskManagement.create` | Create a column |
| `PATCH` | `/projects/:projectId/columns/:columnId` | `taskManagement.update` | Rename, reorder, set WIP limit |
| `DELETE` | `/projects/:projectId/columns/:columnId` | `taskManagement.delete` | Delete column (block if tasks exist, or reassign) |

---

### Tasks — Core CRUD

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/projects/:projectId/tasks` | `taskManagement.view` | List all tasks (normalized flat list) |
| `POST` | `/projects/:projectId/tasks` | `taskManagement.create` | Create task or subtask |
| `GET` | `/projects/:projectId/tasks/:taskId` | `taskManagement.view` | Fetch single task (full detail) |
| `PATCH` | `/projects/:projectId/tasks/:taskId` | `taskManagement.update` | Partial update |
| `DELETE` | `/projects/:projectId/tasks/:taskId` | `taskManagement.delete` | Soft delete |

---

### Tasks — Sub-resources

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `PATCH` | `/projects/:projectId/tasks/:taskId/position` | `taskManagement.update` | Reorder or move task |
| `PATCH` | `/projects/:projectId/tasks/bulk` | `taskManagement.update` | Bulk update (status, progress, re-parent) |
| `GET` | `/projects/:projectId/tasks/:taskId/comments` | `taskManagement.view` | List comments |
| `POST` | `/projects/:projectId/tasks/:taskId/comments` | `taskManagement.create` | Add comment |
| `PATCH` | `/projects/:projectId/tasks/:taskId/comments/:commentId` | `taskManagement.update` | Edit comment (author only) |
| `DELETE` | `/projects/:projectId/tasks/:taskId/comments/:commentId` | `taskManagement.delete` | Soft-delete comment |
| `GET` | `/projects/:projectId/tasks/:taskId/checklist` | `taskManagement.view` | List checklist items |
| `POST` | `/projects/:projectId/tasks/:taskId/checklist` | `taskManagement.update` | Add checklist item |
| `PATCH` | `/projects/:projectId/tasks/:taskId/checklist/:itemId` | `taskManagement.update` | Update item (text, completed, order) |
| `DELETE` | `/projects/:projectId/tasks/:taskId/checklist/:itemId` | `taskManagement.update` | Delete item |
| `GET` | `/projects/:projectId/tasks/:taskId/dependencies` | `taskManagement.view` | List dependencies |
| `POST` | `/projects/:projectId/tasks/:taskId/dependencies` | `taskManagement.update` | Add dependency |
| `DELETE` | `/projects/:projectId/tasks/:taskId/dependencies/:depId` | `taskManagement.update` | Remove dependency |

---

## DTO Reference

### `CreateTaskDto`

```typescript
{
  parentTaskId?:      string (UUID, optional — null = top-level task)
  title:              string (2–500)
  description?:       string (optional)
  status?:            TaskStatus (default TODO)
  workflowColumnId?:  string (UUID, optional)
  priority?:          TaskPriority (optional)
  startDate?:         string (ISO date)
  endDate?:           string (ISO date)
  progress?:          number (0–100)
  assignedMembers:    { userId: string; projectRoleId: string }[]
  reportee:           { userId: string; projectRoleId: string }
  checklistItems?:    { text: string; orderIndex: number }[]
  dependencyIds?:     string[] (UUID[] — predecessors)
  viewMeta?:          { mindmap?: MindmapMeta; gantt?: GanttMeta }
}
```

Validation: if both `startDate` and `endDate` supplied, `startDate <= endDate`.

---

### `UpdateTaskDto`

All fields optional. Same shape as `CreateTaskDto` minus `parentTaskId` (re-parenting is done via `MoveTaskDto`). `assignedMembers` when supplied **replaces** the full assignment set, and `reportee` updates the persisted reportee member.

---

### `MoveTaskDto`

```typescript
{
  parentTaskId?:      string | null  (re-parent; null = promote to top-level)
  workflowColumnId?:  string | null  (move kanban column)
  beforeTaskId?:      string         (insert before this task's rank)
  afterTaskId?:       string         (insert after this task's rank)
}
```

---

### `BulkUpdateTasksDto`

```typescript
{
  items: {
    taskId:           string (UUID)
    status?:          TaskStatus
    progress?:        number (0–100)
    startDate?:       string | null
    endDate?:         string | null
    parentTaskId?:    string | null
    workflowColumnId?: string | null
    viewMeta?:        { mindmap?: MindmapMeta; gantt?: GanttMeta }
  }[]
}
```

---

### `AddCommentDto`

```typescript
{
  body:               string (1–5000)
  parentCommentId?:   string (UUID, optional for threads)
}
```

---

### `AddChecklistItemDto`

```typescript
{
  text:       string (1–500)
  orderIndex: number
}
```

---

### `UpdateChecklistItemDto`

```typescript
{
  text?:       string
  completed?:  boolean
  orderIndex?: number
}
```

When `completed = true`, backend sets `completedByUserId` and `completedAt` on the item.

---

### `AddDependencyDto`

```typescript
{
  dependsOnTaskId:  string (UUID)
  dependencyType?:  DependencyType (default 'FS')
  lagDays?:         number
}
```

---

### `TaskFiltersDto`

```typescript
{
  parentTaskId?:      string | 'root'  ('root' = only top-level tasks)
  status?:            TaskStatus
  priority?:          TaskPriority
  assignedUserId?:    string (userId)
  reporteeUserId?:    string (userId)
  projectRoleId?:     string
  workflowColumnId?:  string
  startDateFrom?:     string (ISO date)
  startDateTo?:       string (ISO date)
  endDateFrom?:       string (ISO date)
  endDateTo?:         string (ISO date)
  hasIncompleteChecklist?: boolean
  includeDeleted?:    boolean (admin only)
  include?:           string  ('assignedMembers,reportee,checklist,dependencies,comments,viewMeta')
  flat?:              boolean (default true — false limits the list to root tasks when parentTaskId is not supplied)
  page?:              number
  limit?:             number
}
```

---

## Service Logic

### `TasksService` — Key Methods

#### `verifyProjectPermission(projectId, requestUser, action)`
Called at the start of task operations. Confirms the project belongs to the organization and that the caller's active project membership role grants the requested `taskManagement` action. Throws `ForbiddenException` otherwise.

#### `createTask(projectId, dto, requestUser)`

1. Verify project role permission for `taskManagement.create`.
2. If `parentTaskId`, verify parent exists in same project and is not deleted.
3. If `workflowColumnId`, verify column belongs to same project.
4. Validate assigned members and reportee are all active project members and match submitted project roles.
5. Validate `startDate <= endDate`.
6. Resolve initial `rank` (append after last sibling under same parent or in same column).
7. If `dependencyIds`, validate each dependency task exists in same project, then run cycle check.
8. Open transaction:
   - Save `Task`.
   - Save `TaskAssignee[]`.
   - Save `TaskChecklistItem[]`.
   - Save `TaskDependency[]` (one per predecessor id).
   - Upsert `TaskViewMetadata` entries from `viewMeta`.
   - Save `TaskActivityLog` with `TASK_CREATED`.
9. Return full serialized task.

#### `updateTask(projectId, taskId, dto, requestUser)`

1. Verify project role permission for `taskManagement.update`.
2. Load task, confirm `projectId` matches.
3. Apply scalar field changes.
4. If `assignedMembers` provided: reconcile — delete removed, insert added, verify each member matches an active project membership role.
5. If `reportee` provided: verify it matches an active project membership role and persist `reporteeUserId`.
6. If `dependencyIds` provided: reconcile — delete removed edges, insert added edges, run cycle check for each new edge.
7. If `workflowColumnId` changes: verify column belongs to project.
8. Upsert `viewMeta` records.
9. Save task + log `TASK_UPDATED` with diff of changed field names.
10. Return full serialized task.

#### `deleteTask(projectId, taskId, requestUser, cascadeChildren = true)`

1. Verify project role permission for `taskManagement.delete`.
2. Load task. If `cascadeChildren = true`, recursively soft-delete all descendants in one UPDATE WHERE `parent_task_id` reachable. If `false`, throw if any live children exist.
3. Set `deletedAt = now()`.
4. Log `TASK_DELETED`.

#### `getProjectTasks(projectId, filters, requestUser)`

Returns flat normalized list. No deep nesting. The frontend derives tree structure client-side using `parentTaskId`.

Query builder flow:
- Base: `WHERE project_id = :projectId AND deleted_at IS NULL`
- If `parentTaskId = 'root'`: add `AND parent_task_id IS NULL`
- If `parentTaskId = <uuid>`: add `AND parent_task_id = :parentTaskId`
- Conditional left-joins based on `include` param: `assignees`, `checklistItems`, `comments` (non-deleted), `dependencyEdges`, `viewMetadataEntries`.
- Compute `childCount` and `commentCount` as subquery scalars.
- Pagination via `skip`/`take`.

Response shape:
```json
{
  "items": [ ...TaskListItemSerializer ],
  "meta": { "projectId": "...", "flat": true },
  "count": 42,
  "pages": 5,
  "page": 1,
  "limit": 10
}
```

#### `moveTask(projectId, taskId, dto, requestUser)` — position endpoint

1. Verify project role permission for `taskManagement.update`.
2. Load task.
3. If `parentTaskId` changes: validate new parent exists in same project, not deleted, and not a descendant of the task being moved (circular hierarchy prevention).
4. If `workflowColumnId` changes: verify column belongs to project. Log `TASK_MOVED`.
5. Recalculate `rank` using `beforeTaskId` / `afterTaskId`:
   - Load ranks of the two neighbors; compute midpoint string.
   - If gap is exhausted, rebalance sibling ranks in same scope.
6. Save. Return updated task.

#### `bulkUpdateTasks(projectId, dto, requestUser)`

Iterate items, apply updates, skip tasks that don't belong to the project. Run in one transaction. Return updated task list.

#### Cycle detection for dependencies

When adding `taskA → dependsOnTaskB`:
- BFS/DFS from `taskA` following existing outgoing edges.
- If `taskB` is reachable from `taskA`, a cycle would form — throw `BadRequestException`.
- Keep this within transaction before inserting the new edge.

---

## Serializers

### `TaskSerializer` (full detail — GET /tasks/:id)

Exposes all fields including:
- `assignees[]` — `{ userId, firstName, lastName, assignmentRole }`
- `checklistItems[]` — ordered by `orderIndex`
- `comments[]` — ordered by `createdAt ASC`, excludes soft-deleted
- `dependencies[]` — `{ id, dependsOnTaskId, dependencyType, lagDays }`
- `viewMeta` — shaped as `{ mindmap?: {...}, gantt?: {...} }` derived from `viewMetadataEntries`
- `childCount` — virtual, computed from children relation count
- `commentCount` — virtual

### `TaskListItemSerializer` (list — GET /tasks)

Slimmed version — no comments body, no full checklist text. Includes:
- All canonical scalar fields
- `assignees[]` — userId + assignmentRole only
- `checklistItems[]` — id, completed, orderIndex (no text for list perf)
- `dependencyIds[]` — array of predecessor UUIDs
- `viewMeta` — full (mindmap + gantt needed by all three views)
- `childCount`, `commentCount`

### `WorkflowColumnSerializer`

- `id`, `projectId`, `name`, `statusKey`, `orderIndex`, `wipLimit`, `createdAt`, `updatedAt`
- Optional `taskCount` (count of non-deleted tasks in column)

---

## Module Registration

### `tasks.module.ts`

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      WorkflowColumn,
      TaskAssignee,
      TaskChecklistItem,
      TaskComment,
      TaskDependency,
      TaskViewMetadata,
      TaskActivityLog,
      // Cross-module references (read-only)
      Project,
      ProjectMembership,
      User,
    ]),
  ],
  controllers: [TasksController],
  providers:   [TasksService],
  exports:     [TasksService],   // future: DocumentsModule will need task validation
})
export class TasksModule {}
```

Register `TasksModule` in `AppModule`.

---

## Domain Invariants Summary

| # | Rule | Enforcement |
|---|------|-------------|
| 1 | Task `projectId` must match route `:projectId` | Service — every load |
| 2 | `parent_task_id` must reference a task in the same project | Service — on create/move |
| 3 | No task can be its own ancestor | Service — on re-parent |
| 4 | Assignees must be active project members | Service — on create/update |
| 5 | Dependencies must reference tasks in the same project | Service — on add dependency |
| 6 | No self-dependency | DB CHECK + Service |
| 7 | No cyclic dependency graph | Service — BFS before insert |
| 8 | `startDate <= endDate` when both present | DTO + Service |
| 9 | Soft-deleted tasks excluded from all reads by default | All queries filter `deleted_at IS NULL` |
| 10 | Deleting a parent cascades or blocks depending on mode | Service — delete method |
| 11 | Workflow columns must belong to the same project as the task | Service — on create/update |
| 12 | `viewMeta` is non-authoritative — never used for business logic | Convention — documented here |

---

## Delivery Phases

### Phase 1 — Foundation (build first, blocks everything)

- Migration file (all 8 tables + indexes)
- All entity files
- `WorkflowColumn` CRUD (columns are required before tasks can be column-assigned)
- `TasksModule` wiring + registration in `AppModule`

### Phase 2 — Core Task CRUD

- `CreateTaskDto`, `UpdateTaskDto`, `TaskFiltersDto`
- `TasksService.createTask`
- `TasksService.updateTask`
- `TasksService.deleteTask`
- `TasksService.getTask`
- `TasksService.getProjectTasks`
- `TaskSerializer`, `TaskListItemSerializer`
- Full controller endpoints for core CRUD

At end of Phase 2: Kanban list view is fully functional.

### Phase 3 — Position and Bulk

- `MoveTaskDto`, `BulkUpdateTasksDto`
- `TasksService.moveTask` with rank recalculation
- `TasksService.bulkUpdateTasks`
- Corresponding controller endpoints

At end of Phase 3: Kanban drag-and-drop and status changes work. Gantt reordering works.

### Phase 4 — Sub-resources

- Checklist item CRUD
- Comment CRUD
- Dependency add/remove with cycle detection
- View metadata upsert (can be done inside update task or as separate endpoints)
- `TaskActivityLog` entries for all operations

At end of Phase 4: Full task sheet works. Mindmap and Gantt have all the data they need (hierarchy via `parentTaskId`, scheduling via dates/dependencies, layout via `viewMeta`).

### Phase 5 — Hardening

- Add `task_id` to `project_activity_logs` (already has `taskId` column in `ProjectActivityLog` entity — ensure it is populated on task actions)
- Rank rebalancing edge cases
- Validate `include` query param to prevent over-fetching
- Ensure all task endpoints use project-role-based `taskManagement` permission checks
- Swagger documentation on all DTOs and endpoints

---

## Relation to Other Modules

- **Documents module (Workstream 5)**: Documents link to `taskId`. The `TasksService` should expose a `findOneOrFail(taskId, projectId)` helper for use by `DocumentsService` to verify task ownership.
- **ProjectActivityLog**: The existing `taskId` nullable column on `project_activity_logs` allows project-level contribution history to reference task events. Populate it when logging task operations.
- **ProjectPermissionGuard**: All task endpoints use `RequireProjectPermission('taskManagement', action)` and resolve permissions from the caller's project membership role.

---

## View-Specific Notes

### Kanban
Groups tasks by `workflowColumnId`. Columns are fetched first from `GET /projects/:id/columns`, then tasks fetched with `GET /projects/:id/tasks?include=assignees,checklist`. Drag between columns calls `PATCH /tasks/:id/position` with new `workflowColumnId`. Drag within column updates `rank` only.

### Mindmap
Fetches all tasks flat: `GET /projects/:id/tasks?include=viewMeta`. Builds tree client-side using `parentTaskId`. Node positions come from `viewMeta.mindmap.{ x, y, collapsed }`. Layout save calls `PATCH /tasks/:id` with `viewMeta.mindmap` update — no status/content changes needed.

### Gantt
Fetches all tasks flat: `GET /projects/:id/tasks?include=assignees,dependencies,viewMeta`. Rows are grouped/indented by `parentTaskId`. Bars use `startDate`/`endDate`. Dependency arrows use `task_dependencies`. Bar color override from `viewMeta.gantt.barColor`. Progress bar from `progress` field.

---

## Files to Create (Checklist)

- [ ] `src/migrations/<ts>-create-tasks.ts`
- [ ] `src/tasks/entities/task.entity.ts`
- [ ] `src/tasks/workflow/workflow-column.entity.ts`
- [ ] `src/tasks/entities/task-assignee.entity.ts`
- [ ] `src/tasks/entities/task-checklist-item.entity.ts`
- [ ] `src/tasks/entities/task-comment.entity.ts`
- [ ] `src/tasks/entities/task-dependency.entity.ts`
- [ ] `src/tasks/entities/task-view-metadata.entity.ts`
- [ ] `src/tasks/entities/task-activity-log.entity.ts`
- [ ] `src/tasks/entities/index.ts`
- [ ] `src/tasks/dtos/create-task.dto.ts`
- [ ] `src/tasks/dtos/update-task.dto.ts`
- [ ] `src/tasks/dtos/task-filters.dto.ts`
- [ ] `src/tasks/dtos/move-task.dto.ts`
- [ ] `src/tasks/dtos/bulk-update-tasks.dto.ts`
- [ ] `src/tasks/dtos/add-comment.dto.ts`
- [ ] `src/tasks/dtos/update-comment.dto.ts`
- [ ] `src/tasks/dtos/add-checklist-item.dto.ts`
- [ ] `src/tasks/dtos/update-checklist-item.dto.ts`
- [ ] `src/tasks/dtos/add-dependency.dto.ts`
- [ ] `src/tasks/dtos/create-workflow-column.dto.ts`
- [ ] `src/tasks/dtos/update-workflow-column.dto.ts`
- [ ] `src/tasks/dtos/index.ts`
- [ ] `src/tasks/serializers/task.serializer.ts`
- [ ] `src/tasks/serializers/task-list-item.serializer.ts`
- [ ] `src/tasks/serializers/workflow-column.serializer.ts`
- [ ] `src/tasks/serializers/index.ts`
- [ ] `src/tasks/messages/error.ts`
- [ ] `src/tasks/messages/success.ts`
- [ ] `src/tasks/messages/index.ts`
- [ ] `src/tasks/tasks.service.ts`
- [ ] `src/tasks/tasks.controller.ts`
- [ ] `src/tasks/tasks.module.ts`
- [ ] Register `TasksModule` in `src/app.module.ts`
