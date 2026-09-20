# Checklist workflow: backend contract and rollout

Implemented 2026-09-20. This document describes the implemented backend contract and supersedes the proposed contracts in the implementation plan. Frontend application code is unchanged. Resources and time tokens remain deferred.

## Approved rules

- The task's current assignees execute, upload deliverable versions, submit, withdraw and branch. Checklist assignment/reportee fields are projections of the owning task.
- The current task reportee reviews, accepts, rejects and edits active review notes. A dual-role user may self-approve; returning their Review item requires explicit `REJECT` or `WITHDRAW` intent.
- Current reportees of a task or its ancestors manage definitions and assignments. A former creator receives no authority merely from authorship.
- Active task participants can read their own work without extra project-role grants. Existing all-task visibility grants remain. Assignment to a child does not grant visibility into its ancestors or siblings. Watchers are not visibility grants.
- Tasks derive status from all unbranched checklist items and direct child tasks, including work hidden from the caller. Linked child work is counted once. Lowest stage wins: Todo, In Progress, In Review, Done. Empty new tasks start Todo; legacy Done is retained.
- Custom checklist states retain Todo or In Progress as their effective stage. Withdrawing/rejecting Review to a custom state resets effective stage to In Progress.
- Done is terminal. No incomplete work may be added or moved underneath Done. Dependencies and planned dates produce advisory warnings, not submission gates.
- Submission notes, rejection notes and uploaded evidence are optional. Submission snapshots the uploaded deliverable versions actually available at submission time. Review is required even if there are no uploaded files.

## Command endpoints

All paths below are relative to `/projects/:projectId/tasks/:taskId`. Use the deployment's existing API base prefix and authenticated request mechanism. JSON responses use the existing application response wrapper; examples below are its `data` payload or request body.

| Method/path | Request | Behavior |
| --- | --- | --- |
| `PATCH /checklist/:itemId/move` | `expectedRevision`, `idempotencyKey`, `statusId`; optional `intent`, `beforeItemId`, `afterItemId`, `reviewNote` | Active movement, drag submission/review, or ordering. |
| `POST /checklist/:itemId/submissions` | `expectedRevision`, `idempotencyKey`, optional `submissionNote` | Assignee submits to canonical Review. |
| `POST /checklist/:itemId/submissions/:submissionId/decision` | `expectedRevision`, `idempotencyKey`, `decision`: `ACCEPT`, `REJECT`, or `WITHDRAW`; `statusId` required for returns; optional `reviewNote` | Resolves exactly the active attempt. |
| `PATCH /checklist/:itemId/submissions/:submissionId/notes` | `expectedRevision`, `idempotencyKey`, `text`; for edits `noteId` and `expectedNoteRevision` | Appends an attributable note revision while Review remains active. |
| `GET /checklist/:itemId/submissions` | Query: `limit` (1–100, default 25), optional `beforeAttempt` | Newest-first attempts, notes, exact evidence snapshots and current file availability; response includes `nextBeforeAttempt`. |
| `DELETE /reportee` | `expectedRevision`, `idempotencyKey` | Authorized higher reportee removes a child's reportee; atomically replaces it with the immediate parent's current reportee. Root removal is rejected. Creator unchanged. |
| `PATCH /checklist/:itemId` | Definition fields, optional `expectedRevision` | Supports description, durationDays, earliestStartDate and dependencies; rejects status/completed writes. |

Example submission:

```json
{"expectedRevision":7,"idempotencyKey":"submission-7-client-generated-uuid","submissionNote":"Ready for review"}
```

Example rejection:

```json
{"expectedRevision":8,"idempotencyKey":"review-8-client-generated-uuid","decision":"REJECT","statusId":"<canonical-todo-or-progress-or-custom-status-uuid>","reviewNote":"Please revise the drawing"}
```

A successful transition returns `item` (with `revision`), `effects`, `submissionEffect`, caller-visible `changedTasks`, `changedChecklistItems`, `changedTaskIds`, `changedItemIds`, current `capabilities`, `warnings`, and `replayed`. Item/detail/list/board reads expose revisions, capabilities and active submission metadata. Definition mutation responses include the owning task's refreshed status, progress, completion and revision, plus `cascade.calculationRunId` and caller-visible `cascade.refreshTaskIds` for conservative schedule/hierarchy refresh.

Use a unique idempotency key per user intent, retained across network retries. Replay with the same key and normalized command returns the committed result without repeating history, even if the submitted revision is now stale. Reusing a key with different content conflicts. Drag-to-Review and explicit submission use the same command engine. Reordering inside Review does not create another attempt. Refresh current reads after a replay because its committed projection can be older than subsequent changes; replay still filters changed IDs against current visibility.

On a fresh command, `expectedRevision` is mandatory and must match the latest item revision (task revision for reportee removal). After every mutation, refresh the affected task/checklist views. For structural, definition and scheduling edits, also refresh the visible hierarchy and schedule; the server may change ancestors and successors.

## Read and UI behavior

Use canonical status metadata rather than label comparisons. `canonicalStage` is one of `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, or null for a custom checklist state. Canonical config rows cannot be removed, disabled or remapped; task statuses cannot be manually selected.

Checklist capabilities include `allowedTargetStatusIds`, `canSubmit`, `canWithdraw`, `canReview`, `canEditSubmissionNotes`, and `canUploadDeliverables`; branching is exposed separately as `canBranch`. Task capabilities include definition/assignment management, reportee removal, and false values for manual move/complete/reopen. Capability values are UI hints; every command rechecks live relationships under the workflow lock. Existing projects awaiting activation expose disabled workflow capabilities.

Normal checklist Kanban counts/cards exclude branched source items. Branch links, inverse descriptions and inherited task starter documents remain available in detail. The source status mirrors the child task. Users must withdraw Review before branching. New child/package work starts Todo.

Typical conflicts: `STALE_WORKFLOW_REVISION`, `IDEMPOTENCY_KEY_REUSED`, `CHECKLIST_REVIEW_REQUIRED`, `CHECKLIST_ALREADY_SUBMITTED`, `CHECKLIST_RETURN_INTENT_REQUIRED`, `SUBMISSION_IS_NOT_ACTIVE`, `CHECKLIST_DONE_IS_TERMINAL`, `TASK_WORKFLOW_CLOSED`, `BRANCHED_CHECKLIST_STATUS_IS_DERIVED`, `COMPLETED_TASK_STRUCTURE_IS_TERMINAL`, and `WORKFLOW_MIGRATION_REQUIRED`. Missing access remains 403 or 404 according to the existing endpoint contract. Do not retry a conflict indefinitely; refetch state and ask for a new user action.

Removed behavior: task move/complete/reopen and client task status writes return `TASK_STATUS_IS_DERIVED`. Whole checklist-list replacement is rejected. Legacy boolean-only offline checklist toggles return `WORKFLOW_COMMAND_REQUIRED` before any event in that batch is applied. Other sync events use per-event rollback boundaries and live task authorization.

## Documents, history and change requests

Document types are `STARTER`, `DELIVERABLE`, and `REFERENCE`. Reference documents belong to the task; deliverables require an owning checklist. A deliverable definition can exist without a file. Listing accepts `scope=TASK` or `scope=CHECKLIST` and `checklistItemId`. Definitions are reportee-managed; current assignees can upload deliverable versions. Uploads to completed work and branched sources are rejected.

| Endpoint | Purpose |
| --- | --- |
| Existing document create/update multipart endpoints | Upload a new immutable attachment identity; retain replaced versions. Client-provided storage-reference lists are rejected. |
| `GET /documents/:documentId/history` | Retained definition revisions. |
| `DELETE /documents/:documentId/attachments/:attachmentId` | Tombstone one version, retaining its metadata and evidence references. |
| `GET /documents/:documentId/attachments/:attachmentId/content` | Authenticated content with current task authorization and `Cache-Control: private, no-store`; tombstoned content returns 410. |

Returned `downloadUrl` values point to the authenticated content route. Fetch using the API client credentials, then open/download the returned blob; do not treat it as a public signed URL. Apply the API base prefix when resolving the path.

Deletion is scoped to the document/version reference. A shared blob remains retained for other valid references, while the deleted reference cannot serve content. Historical evidence keeps the exact attachment UUID and metadata snapshot; later replacements never rewrite it. Show `fileAvailable=false` and `deletedAt` rather than removing history rows. No old signed URL is stored in new evidence snapshots.

Checklist-origin change requests use optional `checklistItemId` on the existing create/filter contract. The backend validates that it belongs to the task. Resolving a conversation does not automatically change task/checklist definitions or approve work.

## Migration and activation runbook

No production database or object store was modified during implementation. Tests used an isolated disposable PostgreSQL instance. Deployment and per-project activation remain operator actions.

1. Back up the database and verify restoration. Coordinate a backend/frontend maintenance window: old clients cannot use the retired completion/toggle flows.
2. Build and run the repository's normal migrations. Keep `synchronize:false`. New migrations add history/receipts, canonical mapping, tombstones, retained FKs, ownership safeguards, activation and audit records. A new earlier-timestamp migration decouples the historical audit status enum so the full migration chain also works on a fresh database; no old migration file was edited.
3. Inspect `workflow_migration_audit`. Classification maps only the repository's known canonical keys. Legacy unbranched Review returns to In Progress with an explicit migration audit entry and must be genuinely resubmitted. Legacy Done remains Done without invented submissions. Checklist assignment snapshots are reconciled to the owning task. Missing reportees are restored to the original creator only when that user is still an active project member; ambiguous rows remain blocked.
4. Preview each existing project against the intended database configuration:

   ```sh
   npm run workflow:backfill -- --project-id=<project-uuid>
   ```

   Preview takes the workflow lock, audits invariants, computes before/after projections and **rolls back**. Review its JSON report. Resolve missing/ambiguous canonical stages, invalid reportees, contradictory completion, invalid branches and hierarchy cycles explicitly. Legacy custom-state items require an operator-reviewed effective Todo/In Progress value and a `CUSTOM_STAGE_REPAIRED` entry in `workflow_migration_audit` containing the item ID, project ID, before/after values and rationale; the audit will not guess their prior active stage. Do not fabricate review history or reopen Done to silence the audit.
5. Apply the reviewed project backfill:

   ```sh
   npm run workflow:backfill -- --project-id=<project-uuid> --apply
   ```

   This reruns the audit, recomputes all projections, writes the activation audit snapshot and enables that project's workflow in one transaction. An error rolls back. Existing projects stay blocked until successful activation; newly created projects use canonical defaults.
6. Retire previously issued 24-hour signed URLs before promising immediate revocation of legacy links: stop old URL issuance and wait out the longest existing expiry, or revoke/rotate the signing credentials through the storage deployment procedure. New authenticated routes enforce tombstones immediately. Keeping the old deployment issuing links defeats the expiry window.
7. Smoke-test participant reads, submit/withdraw/resubmit, reviewer accept/reject, inherited reportee management, history, deleted content, branching and board refresh with the new frontend. Monitor conflict/error rates and the existing outbox.

Offboarding a current reportee from a project/workspace or disabling their account is blocked until ownership is resolved. Root reportees cannot be removed through the workflow API. The initial implementation serializes workflow/structure mutations per project using transactional advisory locks; optimize only after measuring contention.

Rollback is a coordinated application rollback with workflow writes stopped, or a roll-forward repair. Do not restore the old write paths over recorded new history. History-bearing down migrations refuse destructive reversal; classification is deliberately forward-only. Keep database backups and audit snapshots for operational recovery.

## Verification

The backend build and full Jest suite are the release checks. PostgreSQL tests are enabled explicitly; without their environment variables they are skipped. Use a dedicated disposable database whose name ends in `_test` for the workflow suite.

```sh
TASK_PACKAGE_TEST_PG_HOST=<host> TASK_PACKAGE_TEST_PG_PORT=<port> \
TASK_PACKAGE_TEST_PG_USER=<user> TASK_PACKAGE_TEST_PG_DATABASE=<disposable_test> \
TASK_WORKFLOW_TEST_PG_HOST=<host> TASK_WORKFLOW_TEST_PG_PORT=<port> \
TASK_WORKFLOW_TEST_PG_USER=<user> TASK_WORKFLOW_TEST_PG_DATABASE=<disposable_test> \
npm test -- --runInBand
```

Coverage includes the migrated schema, authenticated HTTP handlers with real permission guard (JWT identity is test-injected), no-role participants, duplicate retries, accept/withdraw races, sibling completion races, immutable/deleted evidence, note revisions, custom stages, branch projections, hidden search results, upload terminality, ownership fallback/offboarding, activation preview rollback and populated legacy classification. Storage bytes are supplied by a test adapter; real deployment storage credentials and legacy-link retirement require the rollout smoke test.

### Recorded implementation verification (2026-09-20)

- `npm run build`: passed.
- Full Jest suite with both PostgreSQL suites enabled: **109 passed, 11 suites, zero skipped**; includes 20 workflow integration tests.
- Full historical and new migration chain from an empty disposable database: passed; workflow integration tests passed against that migrated schema.
- Backfill CLI rollback-preview and apply modes: both executed successfully on disposable migrated data.
- `git diff --check`: passed. New workflow domain/service, DTOs, entities, migrations and backfill script pass scoped ESLint. The broader touched-file ESLint check is not clean: unsafe typing and async/test-adapter diagnostics remain; this is not a repository-wide lint-pass claim.
- Real object-store behavior, deployment identity integration and legacy signed-link retirement remain deployment smoke checks. No production activation was attempted.

Acceptance coverage: AC01–AC08 cover relationship permissions, lifecycle, retries, races and bypass closure; AC09–AC15 cover package branching, inherited assignment, reportee fallback, rollups and board eligibility; AC16–AC19 cover retained documents, scopes, advisory scheduling and separate conversation resolution; AC21 covers hidden direct reads and search. These are backend changes. AC20 navigation restoration and AC22 user-facing reconciliation errors require the subsequent frontend implementation; stable identities, authoritative revisions and replay-safe commands supply their backend support.
