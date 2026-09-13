# Atomic task package creation

`POST /projects/:projectId/task-packages` accepts the frontend multipart contract. Authentication, workspace scope, and `taskManagement.create` permissions follow the existing project endpoints.

## Request and agreed changes

Send one `payload` JSON string plus binary parts identified by `fileKey` (`file_0`, `file_1`, …). The payload contains `task`, `generalStarterDocuments`, `checklists`, `dependencies`, `checklistMode`, and optional `branchFrom`. The frontend implementation and full example live in `archkalinga-frontend-v1/docs/task-package-create-api-contract.md`.

- The authenticated creator is always the reportee. Supplied reportee values are ignored. This also applies to standalone task/subtask creation, checklist branching, template tasks, and schedule imports. Existing tasks are not backfilled, and later reportee-update behavior is unchanged.
- Assignees are optional. Package assignments must match active project memberships and roles; package creation does not invite non-members.
- `checklistMode: "UNBRANCHED"` is accepted and is also the default when omitted. Each checklist is stored with `branchedTaskId: null` and `branchStatus: "flat"` (the existing unbranched enum). No child tasks are created for these items. Description, assignments, creator/reportee, duration, start constraint, documents, deliverable definitions, and dependencies are retained on checklist records and related tables. Client IDs are resolved only within this package. Duplicate IDs/edges, missing references, self-dependencies, and cycles are rejected. All four dependency types (`FS`, `SS`, `FF`, `SF`) and signed integer lag are supported.
- A checklist's supplied `plannedStartDate` is persisted separately as its `earliestStartDate`: the task may start later due to dependencies, but not earlier. Duration defaults to one working day. Project calendars and exceptions apply, and parent dates roll up from children. This route does not require manual scheduling flags or reasons.
- Expected deliverables use `DELIVERABLE / DEFINE`: name and description, no attachment at creation.
- Starter uploads use `STARTER / UPLOAD` and a unique `fileKey` pointing to exactly one binary part. Duplicate filenames are allowed; duplicate keys, empty/missing parts, and unreferenced parts are rejected.
- Existing-file starters use `STARTER / FROM_DELIVERABLE` and **`sourceAttachmentId`**, the UUID of the existing active deliverable attachment. The backend resolves the source document and task and checks project scope and visibility. Optional `sourceDocumentId` and `sourceTaskId` must match the actual owner. A document UUID alone is insufficient; definitions without uploaded files cannot be used as file inputs. The new starter references that exact file, with source traceability; it does not select a newer version automatically.

```json
{
  "name": "Approved drawing",
  "description": "Use as input",
  "attachmentNotes": null,
  "type": "STARTER",
  "mode": "FROM_DELIVERABLE",
  "sourceAttachmentId": "existing-file-attachment-uuid",
  "sourceDocumentId": "owning-document-uuid",
  "sourceTaskId": "owning-task-uuid"
}
```

Limits: titles 2–120 characters, document names 1–160 characters, description text at most 4,000 characters, 100 checklist items, 25 uploaded files of at most 10 MiB each, and one JSON field of at most 2 MiB. Checklist durations are positive integers. Arrays may be empty or omitted.

## Commit and response

Task rows, checklist-board items, assignments, documents, attachment references, dependencies, progress, calculated schedules, logs, and outbox events share one TypeORM transaction. The response is loaded and serialized before commit and returned afterward:

```ts
{
  statusCode: 201,
  message: 'Task package created',
  data: { parentTask, checklistItems, checklistTasks: [], documentCount, dependencyCount }
}
```

Uploads use unique object names registered before attempting storage writes. On failure, database changes roll back and compensating cleanup attempts to remove every new object, including a file whose upload response was ambiguous. Referenced source objects are never deleted. Cleanup failures are retried three times and logged with object identifiers; a process crash or persistent storage outage can leave orphaned objects requiring operational cleanup. Storage is not a database transaction.

Outbox rows are visible to workers only after commit. Validation/storage/database failures return a non-2xx response. A lost successful response can still mean the package committed; durable idempotent retries remain outside this contract.

## Branch wizard submission

Send the normal package with:

```json
{
  "checklistMode": "UNBRANCHED",
  "branchFrom": {
    "taskId": "source-owner-task-uuid",
    "checklistItemId": "source-checklist-uuid"
  }
}
```

The package must contain at least one checklist. Project creation permission and source checklist branch permission are required. The source is locked within the transaction and checked for ownership, visibility, active owner, and existing link. Completed sources/owners must be reopened first. An already linked source returns HTTP 409; simultaneous submissions cannot create two branches.

The new task is a child of the source owner. Its own checklists are unbranched. The source becomes `branchStatus: "branched"`, receives the new task's ID, branch actor and timestamp, and retains its original content. No source description, document, or assignment is silently copied into the new package. The wizard supplies the desired new content. Source schedule constraints remain effective when calculating its linked work.

Creation, source linking, progress/scheduling, activity logs, and outbox writes commit together. A failure rolls back both the new package and source link and cleans up new uploads as described above. Read the created ID from **`data.parentTask.id`**. Opening or cancelling the wizard needs no backend mutation.

## Reading checklist work

Task detail, task lists/tree, checklist listing, and checklist Kanban expose descriptions and permission-aware `canBranch`. Completed items, completed/inactive owners, linked items, or actors lacking branch/create permission cannot branch. New tasks expose `branchedFromChecklist` when the source owner is visible to the reader.

`GET /projects/:projectId/tasks/:taskId/checklist/:itemId` returns checklist detail, documents, and outgoing checklist dependencies. Legacy linked items also expose their retained child task's documents and task dependencies under `legacyTask`. Document responses include `checklistItemId`; task-document listing accepts that filter to retrieve only the selected checklist's records. General task documents have a null checklist owner.

Progress for package-managed work derives from checklist completion and linked task progress, counting a linked child only once. Scheduling supports `FS`, `SS`, `FF`, and `SF`, working calendars, lag, and earliest-start constraints without creating synthetic database tasks.

## Existing data and rollout

Apply both migrations through the normal migration process:

- `1789700000000-add-task-earliest-start-date`
- `1789800000000-defer-checklist-branching`

The deferred-branch migration is additive. Existing branches remain linked and operational. It backfills checklist metadata, marks legacy branches, and records snapshots of child tasks, schedules, documents and dependencies in `checklist_legacy_branch_records`. Activity-log evidence identifies automatically created package branches. History and attachments stay attached to their existing tasks/documents.

This is preservation and inventory, not automatic conversion to flat checklists. Converting historical branches requires a separately reviewed transfer of their work/history and task references. Do not clear their links. Inspect the retained inventory with:

```sql
SELECT owner_task_id, checklist_item_id, branched_task_id,
       automatically_created, disposition
FROM checklist_legacy_branch_records;
```

The migration was applied to the local application database on 2026-09-13. All 19 existing links were preserved (2 identified as automatic package branches, 17 others); task, checklist, document, attachment, dependency, activity-log and comment counts were unchanged. Other deployments must apply the migrations before serving this code. Reverting the new migration is refused once new package-managed checklist data exists.

## Verification

PostgreSQL integration tests create and remove an isolated schema. Use an explicit disposable database:

```sh
TASK_PACKAGE_TEST_PG_HOST=/path/to/test/postgres/socket \
TASK_PACKAGE_TEST_PG_PORT=55439 \
npx jest --runInBand
```

Tests use real PostgreSQL transactions, schedule/progress calculations and outbox persistence. Authentication is stubbed at the boundary; object storage is simulated for failure injection. Coverage includes multipart HTTP validation, unbranched creation, all four dependency types, optional assignments, creator/reportee, exact existing-file references, concurrent branching, source-link rollback, upload cleanup, read permissions and migration preservation/reversal. The unrelated change-request audit entity is excluded from the isolated fixture because its existing enum metadata is circular.

Frontend verification: `node scripts/task-package-integration-smoke.mjs`.

All 71 backend tests passed with PostgreSQL enabled. Full TypeScript checking still reports unrelated fixture errors in `task-change-request-impact-map.service.spec.ts` and `task-members.service.spec.ts`.
