# Task Domain — Redesign Specification v2.0

**Date:** 2026-04-19  
**Replaces:** `task-management-implementation-plan.md`  
**Status:** Authoritative design for the next implementation pass

---

## 1. Design Decisions (What and Why)

| Decision | Choice | Rationale |
|---|---|---|
| Status/Priority model | Project-scoped config tables | Per-project workflow customisation; no global enum lock-in |
| workflow_columns | **Removed** — merged into `project_statuses` | One concept, not two. Each status IS a Kanban column |
| Description format | JSONB (TipTap/ProseMirror) | Rich block editor on frontend; headings, lists, mentions |
| Reportee | Stays as dedicated FK on `tasks` | Outcome-owner semantic is distinct from "subscriber" |
| task_watchers | New join table | Notification subscribers who are not assignees |
| task_relations | New table (non-blocking) | "Related", "Duplicate" links distinct from blocking deps |
| Checklist structure | Groups (`task_checklists`) + items | Multiple named checklists per task, like Trello |
| outbox_events | New table | Reliable real-time event delivery; decouples DB write from WS publish |
| version column | Already present via `AppBaseEntity` | Optimistic concurrency for real-time conflict detection |

---

## 2. What Gets Removed

| Removed | Replaced By |
|---|---|
| `workflow_columns` table | `project_statuses` (status owns kanban metadata) |
| `workflow_column.entity.ts` | `project-status.entity.ts` |
| `TaskStatus` enum on `tasks` | `status_id` FK → `project_statuses` |
| `TaskPriority` enum on `tasks` | `priority_id` FK → `project_priorities` |
| `task_checklist_items.task_id` direct FK | `checklist_id` FK → `task_checklists` |
| `tasks.description TEXT` column | `tasks.description JSONB` |
| `tasks.workflowColumnId` / `workflowColumn` relation | absorbed into `statusId` |

---

## 3. Project Config Tables

These are **project-owned definitions**. Every task field that used to be a hardcoded enum becomes a reference to one of these tables.

> **Integrity rule (enforced at service layer):** Every config FK on a task must belong to the same `project_id` as the task.

---

### 3.1 `project_statuses` (replaces `workflow_columns`)

```sql
CREATE TABLE project_statuses (
  pkid          SERIAL PRIMARY KEY,
  id            UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version       INT NOT NULL DEFAULT 1,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Identity
  name          VARCHAR(100) NOT NULL,          -- "To Do", "In Progress", "QA", "Done"
  key           VARCHAR(50)  NOT NULL,           -- "todo", "in_progress" — machine-readable slug

  -- Kanban layout (this is the former workflow_columns metadata)
  color         VARCHAR(20)  NOT NULL DEFAULT '#6B7280',
  order_index   INT          NOT NULL DEFAULT 0,
  wip_limit     INT,                             -- NULL = unlimited

  -- Workflow semantics
  category      VARCHAR(20)  NOT NULL DEFAULT 'in_progress',
  -- ENUM-like: 'todo' | 'in_progress' | 'done'
  -- Used by Gantt (progress colouring) and analytics (cycle time)
  -- 'done' category auto-sets tasks.completed = true
  is_default    BOOLEAN      NOT NULL DEFAULT false,  -- assigned on task create if no status given
  is_terminal   BOOLEAN      NOT NULL DEFAULT false,  -- tasks in terminal status cannot be edited
  is_active     BOOLEAN      NOT NULL DEFAULT true,

  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  UNIQUE (project_id, key)
);
CREATE INDEX idx_project_statuses_project_order ON project_statuses (project_id, order_index);
```

**TypeScript entity:** `src/tasks/project-config/project-status.entity.ts`

```typescript
export enum StatusCategory {
  TODO        = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE        = 'done',
}

@Entity('project_statuses')
export class ProjectStatus extends AppBaseEntity {
  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 20, default: '#6B7280' })
  color: string;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  @Column({ type: 'int', nullable: true })
  wipLimit: number | null;

  @Column({ type: 'enum', enum: StatusCategory, default: StatusCategory.IN_PROGRESS })
  category: StatusCategory;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', default: false })
  isTerminal: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => Task, (t) => t.status)
  tasks: Task[];
}
```

**Default rows seeded on project create:**

| name | key | category | order | color | isDefault | isTerminal |
|---|---|---|---|---|---|---|
| To Do | todo | todo | 0 | #6B7280 | true | false |
| In Progress | in_progress | in_progress | 1 | #3B82F6 | false | false |
| In Review | in_review | in_progress | 2 | #F59E0B | false | false |
| Done | done | done | 3 | #10B981 | false | true |
| Blocked | blocked | in_progress | 4 | #EF4444 | false | false |

---

### 3.2 `project_priorities`

```sql
CREATE TABLE project_priorities (
  pkid        SERIAL PRIMARY KEY,
  id          UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version     INT  NOT NULL DEFAULT 1,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        VARCHAR(50)  NOT NULL,   -- "Low", "High", "Urgent"
  key         VARCHAR(50)  NOT NULL,   -- "low", "high", "urgent"
  level       INT          NOT NULL,   -- 0 (lowest) → N (highest) for sorting
  color       VARCHAR(20)  NOT NULL DEFAULT '#6B7280',
  icon        VARCHAR(50),             -- optional icon name for UI
  is_default  BOOLEAN      NOT NULL DEFAULT false,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);
```

**Default rows seeded on project create:** Low (0), Medium (1), High (2), Urgent (3).

---

### 3.3 `project_severities`

```sql
CREATE TABLE project_severities (
  pkid        SERIAL PRIMARY KEY,
  id          UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version     INT  NOT NULL DEFAULT 1,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        VARCHAR(50)  NOT NULL,   -- "Minor", "Major", "Critical"
  key         VARCHAR(50)  NOT NULL,
  level       INT          NOT NULL,
  color       VARCHAR(20)  NOT NULL DEFAULT '#6B7280',
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);
```

**Default rows:** Minor (0), Major (1), Critical (2).  
Severity is nullable on tasks — only meaningful for Bug-type tasks.

---

### 3.4 `project_task_types`

```sql
CREATE TABLE project_task_types (
  pkid            SERIAL PRIMARY KEY,
  id              UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version         INT  NOT NULL DEFAULT 1,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            VARCHAR(50)  NOT NULL,   -- "Task", "Bug", "Feature", "Story"
  key             VARCHAR(50)  NOT NULL,
  icon            VARCHAR(50),
  color           VARCHAR(20)  NOT NULL DEFAULT '#6B7280',
  is_default      BOOLEAN      NOT NULL DEFAULT false,
  is_subtask_type BOOLEAN      NOT NULL DEFAULT false,
  -- When true, this type is only selectable as a subtask (e.g. "Subtask" type)
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);
```

**Default rows:** Task (default), Bug, Feature, Story, Subtask (subtask type).

---

### 3.5 `project_labels`

```sql
CREATE TABLE project_labels (
  pkid        SERIAL PRIMARY KEY,
  id          UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version     INT  NOT NULL DEFAULT 1,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        VARCHAR(50)   NOT NULL,
  color       VARCHAR(20)   NOT NULL DEFAULT '#6B7280',
  description VARCHAR(200),
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
```

No default rows — labels are project-defined from scratch.

---

## 4. Modified `tasks` Table

### Full DDL

```sql
CREATE TABLE tasks (
  pkid                SERIAL PRIMARY KEY,
  id                  UUID         NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version             INT          NOT NULL DEFAULT 1,
  project_id          UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Hierarchy
  parent_task_id      UUID         REFERENCES tasks(id) ON DELETE CASCADE,

  -- Core content
  title               VARCHAR(500) NOT NULL,
  description         JSONB,                        -- TipTap/ProseMirror document JSON

  -- STATE FKs (replacing enums)
  status_id           UUID         NOT NULL REFERENCES project_statuses(id)   ON DELETE RESTRICT,
  priority_id         UUID         REFERENCES project_priorities(id) ON DELETE SET NULL,
  severity_id         UUID         REFERENCES project_severities(id) ON DELETE SET NULL,  -- nullable; meaningful for bugs
  task_type_id        UUID         NOT NULL REFERENCES project_task_types(id) ON DELETE RESTRICT,

  -- Scheduling (Gantt + deadline)
  start_date          DATE,
  end_date            DATE,          -- serves as due date; Gantt bar end
  progress            SMALLINT     CHECK (progress BETWEEN 0 AND 100),
  completed           BOOLEAN      NOT NULL DEFAULT false,   -- auto-set when status.category = 'done'

  -- Kanban ordering (rank within status, replacing rank-within-column)
  rank                VARCHAR(50),  -- fractional-index string

  -- Ownership
  created_by_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reportee_user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,

  -- Soft delete
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Cross-column integrity: status, priority, type, severity must belong to same project
  -- Enforced at service layer (not DB-level FK check across project_id)
);

-- Indexes
CREATE INDEX idx_tasks_project_parent_deleted    ON tasks (project_id, parent_task_id, deleted_at);
CREATE INDEX idx_tasks_project_status_rank       ON tasks (project_id, status_id, rank, deleted_at);
CREATE INDEX idx_tasks_project_dates_deleted     ON tasks (project_id, start_date, end_date, deleted_at);
CREATE INDEX idx_tasks_project_type              ON tasks (project_id, task_type_id, deleted_at);
CREATE INDEX idx_tasks_status_id                 ON tasks (status_id);
```

### Updated TypeScript Entity (key changes only)

```typescript
@Entity('tasks')
export class Task extends AppBaseEntity {
  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'jsonb', nullable: true })
  description: Record<string, unknown> | null;   // TipTap JSON document

  // ── State FKs ──────────────────────────────────────────────────────────────
  @Column({ type: 'uuid' })
  statusId: string;

  @ManyToOne(() => ProjectStatus, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'status_id' })
  status: ProjectStatus;

  @Column({ type: 'uuid', nullable: true })
  priorityId: string | null;

  @ManyToOne(() => ProjectPriority, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'priority_id' })
  priority: ProjectPriority | null;

  @Column({ type: 'uuid', nullable: true })
  severityId: string | null;

  @ManyToOne(() => ProjectSeverity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'severity_id' })
  severity: ProjectSeverity | null;

  @Column({ type: 'uuid' })
  taskTypeId: string;

  @ManyToOne(() => ProjectTaskType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'task_type_id' })
  taskType: ProjectTaskType;

  // ── Scheduling ──────────────────────────────────────────────────────────────
  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  endDate: string | null;   // due date + Gantt bar end

  @Column({ type: 'smallint', nullable: true })
  progress: number | null;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  // ── Kanban ordering ─────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 50, nullable: true })
  rank: string | null;   // fractional-index within status bucket

  // ── Hierarchy ───────────────────────────────────────────────────────────────
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

  @Column({ type: 'uuid', nullable: true })
  reporteeUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reportee_user_id' })
  reporteeUser: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // ── Relations (loaded on demand) ────────────────────────────────────────────
  @OneToMany(() => TaskAssignee, (a) => a.task)
  assignees: TaskAssignee[];

  @OneToMany(() => TaskChecklist, (c) => c.task)     // groups, not flat items
  checklists: TaskChecklist[];

  @OneToMany(() => TaskLabel, (l) => l.task)
  labels: TaskLabel[];

  @OneToMany(() => TaskComment, (c) => c.task)
  comments: TaskComment[];

  @OneToMany(() => TaskDependency, (d) => d.task)
  dependencyEdges: TaskDependency[];

  @OneToMany(() => TaskRelation, (r) => r.task)
  relations: TaskRelation[];

  @OneToMany(() => TaskWatcher, (w) => w.task)
  watchers: TaskWatcher[];

  @OneToMany(() => TaskViewMetadata, (m) => m.task)
  viewMetadataEntries: TaskViewMetadata[];
}
```

---

## 5. New Task Sub-tables

### 5.1 `task_labels` (many-to-many bridge)

```sql
CREATE TABLE task_labels (
  pkid        SERIAL PRIMARY KEY,
  id          UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version     INT  NOT NULL DEFAULT 1,
  task_id     UUID NOT NULL REFERENCES tasks(id)           ON DELETE CASCADE,
  label_id    UUID NOT NULL REFERENCES project_labels(id)  ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, label_id)
);
```

---

### 5.2 `task_checklists` (checklist groups)

One task can have multiple named checklists (e.g. "Definition of Done", "QA Checklist").

```sql
CREATE TABLE task_checklists (
  pkid        SERIAL PRIMARY KEY,
  id          UUID         NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version     INT          NOT NULL DEFAULT 1,
  task_id     UUID         NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL DEFAULT 'Checklist',
  order_index INT          NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_checklists_task ON task_checklists (task_id, order_index);
```

---

### 5.3 `task_checklist_items` (updated — refs checklist, not task)

```sql
CREATE TABLE task_checklist_items (
  pkid                  SERIAL PRIMARY KEY,
  id                    UUID         NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version               INT          NOT NULL DEFAULT 1,
  checklist_id          UUID         NOT NULL REFERENCES task_checklists(id) ON DELETE CASCADE,
  text                  VARCHAR(500) NOT NULL,
  completed             BOOLEAN      NOT NULL DEFAULT false,
  order_index           INT          NOT NULL DEFAULT 0,
  completed_by_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_checklist_items_checklist ON task_checklist_items (checklist_id, order_index);
```

---

### 5.4 `task_watchers` (new)

People who receive notifications but are not assignees.

```sql
CREATE TABLE task_watchers (
  pkid        SERIAL PRIMARY KEY,
  id          UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version     INT  NOT NULL DEFAULT 1,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id)
);
```

**Auto-watch rules (enforced in service):**
- Task creator → auto-watched on create
- Assignee added → auto-watched
- Comment author → auto-watched on first comment
- Reportee → auto-watched on create if set

---

### 5.5 `task_relations` (new — non-blocking informational links)

Distinct from `task_dependencies`. These are `"is related to"` or `"duplicates"` links — no execution constraint.

```sql
CREATE TABLE task_relations (
  pkid          SERIAL PRIMARY KEY,
  id            UUID        NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  version       INT         NOT NULL DEFAULT 1,
  task_id       UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  related_to_id UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  relation_type VARCHAR(30) NOT NULL DEFAULT 'related',
  -- 'related'   — generic association
  -- 'duplicate' — this task duplicates related_to_id
  -- 'clones'    — this task clones related_to_id
  -- 'blocks'    — alias for dependency (read-only mirror; do not write here directly)
  created_by_user_id UUID   NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, related_to_id, relation_type),
  CHECK (task_id <> related_to_id)
);
```

> `task_dependencies` remains for **blocking** relationships (the Gantt FS/SS/FF/SF model with lag days and cycle detection). `task_relations` is purely informational — no enforcement, no cycle check needed.

---

### 5.6 `task_activity_logs` (updated enum)

Add new action types to cover the new model. Update the `action_type` enum:

```typescript
export enum TaskActionType {
  TASK_CREATED          = 'TASK_CREATED',
  TASK_UPDATED          = 'TASK_UPDATED',
  TASK_MOVED            = 'TASK_MOVED',         // status changed (Kanban drag)
  TASK_DELETED          = 'TASK_DELETED',
  TASK_ASSIGNED         = 'TASK_ASSIGNED',
  TASK_UNASSIGNED       = 'TASK_UNASSIGNED',
  STATUS_CHANGED        = 'STATUS_CHANGED',
  PRIORITY_CHANGED      = 'PRIORITY_CHANGED',
  TYPE_CHANGED          = 'TYPE_CHANGED',
  LABEL_ADDED           = 'LABEL_ADDED',
  LABEL_REMOVED         = 'LABEL_REMOVED',
  WATCHER_ADDED         = 'WATCHER_ADDED',
  WATCHER_REMOVED       = 'WATCHER_REMOVED',
  COMMENT_ADDED         = 'COMMENT_ADDED',
  COMMENT_EDITED        = 'COMMENT_EDITED',
  COMMENT_DELETED       = 'COMMENT_DELETED',
  CHECKLIST_CREATED     = 'CHECKLIST_CREATED',
  CHECKLIST_UPDATED     = 'CHECKLIST_UPDATED',
  CHECKLIST_DELETED     = 'CHECKLIST_DELETED',
  CHECKLIST_ITEM_TOGGLED = 'CHECKLIST_ITEM_TOGGLED',
  DEPENDENCY_ADDED      = 'DEPENDENCY_ADDED',
  DEPENDENCY_REMOVED    = 'DEPENDENCY_REMOVED',   // was incorrectly DEPENDENCY_ADDED before
  RELATION_ADDED        = 'RELATION_ADDED',
  RELATION_REMOVED      = 'RELATION_REMOVED',
  DESCRIPTION_UPDATED   = 'DESCRIPTION_UPDATED',
}
```

---

## 6. `outbox_events` Table (Real-time Foundation)

```sql
CREATE TABLE outbox_events (
  pkid            SERIAL PRIMARY KEY,
  id              UUID         NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  project_id      UUID         NOT NULL,        -- for subscriber routing (no FK — log survives project delete)
  aggregate_type  VARCHAR(50)  NOT NULL,
  -- 'task' | 'task_comment' | 'task_checklist' | 'project_status' | 'project_label' | etc.
  aggregate_id    UUID         NOT NULL,         -- the entity that changed
  event_type      VARCHAR(100) NOT NULL,
  -- Mirrors TaskActionType: 'task.status_changed', 'task.comment_added', etc.
  event_payload   JSONB        NOT NULL,         -- full serialized diff / snapshot
  entity_version  INT,                           -- tasks.version at time of event
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ,                   -- NULL = not yet emitted over WebSocket
  failed_at       TIMESTAMPTZ,
  retry_count     INT          NOT NULL DEFAULT 0,
  error_message   TEXT
);

CREATE INDEX idx_outbox_events_unpublished    ON outbox_events (published_at) WHERE published_at IS NULL;
CREATE INDEX idx_outbox_events_project        ON outbox_events (project_id, occurred_at DESC);
CREATE INDEX idx_outbox_events_aggregate      ON outbox_events (aggregate_type, aggregate_id, occurred_at DESC);
```

### How it works

Every service mutation runs inside a DB transaction that:
1. Updates the target table (e.g., `tasks`)
2. Inserts a row into `outbox_events` in the **same transaction**

A background publisher (`OutboxPublisherService`) polls for `published_at IS NULL` rows, emits over WebSocket/SSE, then sets `published_at = now()`. If publish fails, it increments `retry_count` and sets `failed_at`.

**Client catch-up:** On WebSocket reconnect, client sends `lastEventId`. Server queries `outbox_events WHERE project_id = :pid AND occurred_at > :lastOccurredAt ORDER BY occurred_at ASC` and replays missed events. No separate stream table needed — `outbox_events` is the stream.

**Event payload shape:**
```json
{
  "eventType": "task.status_changed",
  "taskId": "uuid",
  "projectId": "uuid",
  "actorId": "uuid",
  "version": 12,
  "mutationId": "client-generated-uuid",
  "changes": {
    "statusId": { "from": "uuid-old", "to": "uuid-new" }
  },
  "timestamp": "2026-04-19T10:00:00Z"
}
```

`mutationId` lets the frontend correlate optimistic updates with server acknowledgements and avoid double-applying confirmed changes.

---

## 7. Migration Plan

### Migration file: `src/migrations/<ts>-task-domain-v2.ts`

**Up:**
1. Drop `workflow_columns` table (tasks.workflow_column_id will be handled)
2. Create `project_statuses`, `project_priorities`, `project_severities`, `project_task_types`, `project_labels`
3. Seed default rows per existing project (via subquery inserts)
4. Alter `tasks` table:
   - `DROP COLUMN status` (enum)
   - `DROP COLUMN priority` (enum)
   - `DROP COLUMN workflow_column_id`
   - `ADD COLUMN status_id UUID NOT NULL REFERENCES project_statuses(id) ON DELETE RESTRICT` — backfill from seeded defaults
   - `ADD COLUMN priority_id UUID REFERENCES project_priorities(id) ON DELETE SET NULL`
   - `ADD COLUMN severity_id UUID REFERENCES project_severities(id) ON DELETE SET NULL`
   - `ADD COLUMN task_type_id UUID NOT NULL REFERENCES project_task_types(id) ON DELETE RESTRICT` — backfill with default type
   - `ALTER COLUMN description TYPE JSONB USING description::JSONB` (existing text descriptions become `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text": ...}]}]}`)
5. Create `task_labels`, `task_checklists`
6. Alter `task_checklist_items`: add `checklist_id`, migrate `task_id`-scoped items into auto-created default checklists, drop `task_id`
7. Create `task_watchers`, `task_relations`
8. Create `outbox_events`
9. Update `task_activity_logs` action_type enum to add new values
10. Drop old enum types from Postgres (`task_status_enum`, `task_priority_enum`)

**Down:**
Reverse in opposite order. Note: JSONB → TEXT description conversion is lossy (structured content collapses to plain text).

---

## 8. Module Structure Changes

```
src/tasks/
├── project-config/                       ← NEW folder
│   ├── project-status.entity.ts
│   ├── project-priority.entity.ts
│   ├── project-severity.entity.ts
│   ├── project-task-type.entity.ts
│   ├── project-label.entity.ts
│   └── index.ts
│
├── entities/
│   ├── task.entity.ts                    ← modified
│   ├── task-assignee.entity.ts           ← unchanged
│   ├── task-checklist.entity.ts          ← NEW (groups)
│   ├── task-checklist-item.entity.ts     ← modified (checklist_id FK)
│   ├── task-comment.entity.ts            ← unchanged
│   ├── task-dependency.entity.ts         ← unchanged
│   ├── task-label.entity.ts              ← NEW (join table)
│   ├── task-relation.entity.ts           ← NEW
│   ├── task-watcher.entity.ts            ← NEW
│   ├── task-view-metadata.entity.ts      ← unchanged
│   ├── task-activity-log.entity.ts       ← updated action types
│   └── index.ts
│
├── outbox/                               ← NEW folder
│   ├── outbox-event.entity.ts
│   ├── outbox-publisher.service.ts
│   └── index.ts
│
├── workflow/                             ← DELETED (workflow-column.entity.ts removed)
│
└── ... (dtos, serializers, etc.)
```

---

## 9. API Contract Changes

### New: Project Config Endpoints

These endpoints let project admins define their workflow, before tasks are created.

| Method | Path | Description |
|---|---|---|
| `GET` | `/projects/:id/statuses` | List all statuses (replaces `GET /columns`) |
| `POST` | `/projects/:id/statuses` | Create a status |
| `PATCH` | `/projects/:id/statuses/:statusId` | Rename, reorder, change color/wipLimit |
| `DELETE` | `/projects/:id/statuses/:statusId` | Delete (block if tasks are assigned to it) |
| `GET` | `/projects/:id/priorities` | List project priorities |
| `POST/PATCH/DELETE` | `/projects/:id/priorities/:id` | Manage priorities |
| `GET` | `/projects/:id/severities` | List severities |
| `POST/PATCH/DELETE` | `/projects/:id/severities/:id` | Manage severities |
| `GET` | `/projects/:id/task-types` | List task types |
| `POST/PATCH/DELETE` | `/projects/:id/task-types/:id` | Manage types |
| `GET` | `/projects/:id/labels` | List labels |
| `POST/PATCH/DELETE` | `/projects/:id/labels/:id` | Manage labels |

### Updated: Task Create/Update DTOs

```typescript
// CreateTaskDto — key changes
{
  title:           string (2–500)
  description?:    Record<string, unknown> | null   // TipTap JSON doc
  statusId?:       string (UUID) — defaults to project's isDefault status
  priorityId?:     string (UUID) | null
  severityId?:     string (UUID) | null              // only meaningful for Bug type
  taskTypeId?:     string (UUID) — defaults to project's isDefault type
  labelIds?:       string[] (UUID[])
  startDate?:      string (ISO date)
  endDate?:        string (ISO date)                 // due date
  progress?:       number (0–100)
  parentTaskId?:   string (UUID) | null
  assignedMembers: { userId: string }[]
  reporteeUserId?: string (UUID) | null
  watcherIds?:     string[] (UUID[])
  // Checklists — supports multiple groups at create time
  checklists?:     { title?: string; items: { text: string; orderIndex: number }[] }[]
  dependencyIds?:  string[] (UUID[])
  viewMeta?:       { mindmap?: MindmapMeta; gantt?: GanttMeta }
  mutationId?:     string  // client-generated idempotency key for real-time correlation
}
```

> **Removed from DTOs:** `workflowColumnId`, `status` (enum), `priority` (enum), `checklistItems[]` (flat)

### Updated: Task Filters

```typescript
// TaskFiltersDto — key changes
{
  statusId?:         string (UUID)                   // was: status enum
  statusCategory?:   'todo' | 'in_progress' | 'done' // filter by category across statuses
  priorityId?:       string (UUID)                   // was: priority enum
  severityId?:       string (UUID)
  taskTypeId?:       string (UUID)
  labelIds?:         string[] (UUID[])
  assignedUserId?:   string
  reporteeUserId?:   string
  watcherUserId?:    string                           // NEW: tasks watched by user
  parentTaskId?:     string | 'root'
  endDateFrom?:      string (ISO date)               // due date range
  endDateTo?:        string (ISO date)
  // ... pagination, include, flat — unchanged
}
```

### Updated: Task Sub-resource Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `.../tasks/:id/checklists` | List all checklists with items |
| `POST` | `.../tasks/:id/checklists` | Create a new checklist group |
| `PATCH` | `.../tasks/:id/checklists/:checklistId` | Rename, reorder group |
| `DELETE` | `.../tasks/:id/checklists/:checklistId` | Delete group and all items |
| `POST` | `.../tasks/:id/checklists/:checklistId/items` | Add item to group |
| `PATCH` | `.../tasks/:id/checklists/:checklistId/items/:itemId` | Update item |
| `DELETE` | `.../tasks/:id/checklists/:checklistId/items/:itemId` | Delete item |
| `GET` | `.../tasks/:id/watchers` | List watchers |
| `POST` | `.../tasks/:id/watchers` | Add watcher |
| `DELETE` | `.../tasks/:id/watchers/:userId` | Remove watcher |
| `GET` | `.../tasks/:id/relations` | List relations |
| `POST` | `.../tasks/:id/relations` | Add relation |
| `DELETE` | `.../tasks/:id/relations/:relationId` | Remove relation |
| `GET` | `.../tasks/:id/labels` | List task labels |
| `POST` | `.../tasks/:id/labels` | Attach label |
| `DELETE` | `.../tasks/:id/labels/:labelId` | Detach label |

### Removed Endpoints

| Removed | Reason |
|---|---|
| `GET /projects/:id/columns` | Replaced by `GET /projects/:id/statuses` |
| `POST /projects/:id/columns` | Replaced by `POST /projects/:id/statuses` |
| `PATCH /projects/:id/columns/:id` | Replaced by `PATCH /projects/:id/statuses/:id` |
| `DELETE /projects/:id/columns/:id` | Replaced by `DELETE /projects/:id/statuses/:id` |

---

## 10. View-Specific Notes

### Kanban

The Kanban board no longer fetches a separate "columns" list and a tasks list. **Statuses ARE the columns.**

```
1. GET /projects/:id/statuses
   → Returns ordered array of statuses (orderIndex, color, wipLimit, taskCount)
   → Each status = one Kanban column

2. GET /projects/:id/tasks?include=assignees,checklists,labels
   → Returns all tasks, flat, with statusId on each
   → Frontend groups tasks by statusId, sorts within group by rank

3. PATCH /projects/:id/tasks/:id/position
   → { statusId: "new-uuid", beforeTaskId?: "...", afterTaskId?: "..." }
   → Server updates status_id + rank, writes STATUS_CHANGED to activity log + outbox_events

4. PATCH /projects/:id/tasks/bulk
   → Drag multiple tasks to a new status in one call
```

**WIP limit enforcement:** When `POST /tasks` or `PATCH .../position` would exceed `status.wipLimit`, the service throws `BadRequestException` with `{ code: "WIP_LIMIT_EXCEEDED", statusId, limit, current }`. Frontend can check this before drop commit and show a warning.

**Real-time Kanban:** Clients subscribe to project room via WebSocket. On task move: server writes `outbox_events`, publisher emits `task.status_changed` event with `{ taskId, statusId, rank, version, mutationId }`. Other clients receive and update their local store. The mutating client ignores the event if `mutationId` matches their optimistic update.

---

### Mindmap

No change from current plan. Mindmap reads `parentTaskId` for tree structure and `viewMeta.mindmap.{ x, y, collapsed }` for node positions.

```
GET /projects/:id/tasks?include=viewMeta,labels
→ Client builds tree from parentTaskId
→ Node positions from viewMeta.mindmap

PATCH /projects/:id/tasks/:id/position
→ { parentTaskId: "new-parent-or-null" }
→ Re-parent with circular hierarchy prevention (assertNotDescendant BFS)
```

**Bulk layout save** (auto-layout after adding many nodes):
```
PATCH /projects/:id/tasks/bulk
→ items: [{ taskId, viewMeta: { mindmap: { x, y } } }]
```
Note: `BulkUpdateTasksDto` must add `viewMeta` support (this was flagged in the readiness audit).

---

### Gantt

No change to scheduling fields. `startDate` / `endDate` drive bar dimensions. `progress` drives bar fill. `task_dependencies` drive dependency arrows.

```
GET /projects/:id/tasks?include=assignees,dependencies,viewMeta,labels
→ Rows grouped/indented by parentTaskId
→ Bars from startDate / endDate
→ Arrows from dependencies (FS/SS/FF/SF + lagDays)
→ Bar color from viewMeta.gantt.barColor

PATCH /projects/:id/tasks/:id
→ { startDate, endDate }     ← bar drag/resize
→ { progress }               ← progress slider

Real-time: 'task.updated' events with startDate/endDate changes update bars live
```

---

## 11. Domain Invariants (Updated)

| # | Rule | Enforcement |
|---|---|---|
| 1 | `task.projectId` must match route `:projectId` | Service — every load |
| 2 | `statusId`, `priorityId`, `severityId`, `taskTypeId`, `labelId` must all belong to the task's `projectId` | Service — on create/update |
| 3 | `project_statuses`: cannot delete a status if tasks are assigned to it | Service — delete status |
| 4 | `project_task_types`: cannot delete a type if tasks are assigned to it | Service — delete type |
| 5 | `parentTaskId` must reference a non-deleted task in the same project | Service — on create/move |
| 6 | No task can be its own ancestor | Service — assertNotDescendant BFS |
| 7 | Assignees must be active project members | Service — on create/update |
| 8 | Watchers must be active project members | Service — on add watcher |
| 9 | No self-dependency | DB CHECK + Service |
| 10 | No cyclic dependency graph | Service — BFS before insert |
| 11 | `startDate <= endDate` when both present | DTO + Service |
| 12 | Soft-deleted tasks excluded from all reads by default | All queries filter `deleted_at IS NULL` |
| 13 | Deleting a parent cascades soft-delete to all descendants | Service — delete method |
| 14 | `task_relations` are informational — no cycle check, no enforcement | Convention |
| 15 | `outbox_events` written in same transaction as the mutation | Service — always |
| 16 | When status.category = 'done', set `tasks.completed = true` | Service — on status change |
| 17 | `task.version` is incremented by TypeORM `@VersionColumn` on every UPDATE | ORM — automatic |
| 18 | `viewMeta` is non-authoritative — never used for business logic | Convention |

---

## 12. Delivery Phases

### Phase 0 — Cleanup
- Delete `workflow-column.entity.ts` and related imports
- Remove `TaskStatus` and `TaskPriority` enums from `task.entity.ts`

### Phase 1 — Project Config Foundation
- Create all 5 `project_config/` entity files
- Migration: create config tables + seed defaults per existing project
- Config CRUD controllers + services for statuses, priorities, types, labels, severities
- Update `ProjectsService.createProject()` to seed all 5 config tables

### Phase 2 — Task Entity Migration
- Migration: alter `tasks` (drop enum columns, add FK columns, backfill, change description to JSONB)
- Update `task.entity.ts`, all DTOs, all serializers
- Fix Bug 2 (assignee names) and Bug 3 (double-join) from readiness audit simultaneously

### Phase 3 — New Sub-tables
- Migration: create `task_checklists`, migrate `task_checklist_items`, create `task_labels`, `task_watchers`, `task_relations`
- Update entities, DTOs, service methods, serializers
- New endpoints: labels, watchers, relations, checklist groups

### Phase 4 — Outbox Events
- Create `outbox_events` table + entity
- Wrap every service mutation in a helper that writes outbox event inside the same transaction
- `OutboxPublisherService` (Bull job or cron) polls and emits

### Phase 5 — Hardening
- Fix Bug 1 (include=comments double-join)
- Fix Bug 4 (wrong action type on dependency delete)
- Add `viewMeta` to `BulkUpdateTasksDto` (Mindmap reflow fix)
- WIP limit enforcement
- Swagger documentation

---

## 13. Final Table Count

| Category | Tables |
|---|---|
| Project config | `project_statuses`, `project_priorities`, `project_severities`, `project_task_types`, `project_labels` = **5** |
| Task runtime | `tasks`, `task_assignees`, `task_labels`, `task_checklists`, `task_checklist_items`, `task_comments`, `task_watchers`, `task_dependencies`, `task_relations`, `task_view_metadata`, `task_activity_logs` = **11** |
| Real-time | `outbox_events` = **1** |
| **Total (task domain)** | **17 tables** |

Plus `projects` (existing) = 18 tables in the full task domain system.
