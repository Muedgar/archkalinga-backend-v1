# Backend-first task/checklist workflow implementation plan

Date: 2026-09-20  
Baseline inspected: `archkalinga-backend-v1.2`, commit `cd487c3`  
Status: implemented in the backend working tree. Production migration/activation has not been performed.

The implemented API contract, approved decisions, migration procedure and verification scope are in [Backend API and rollout handoff](task-checklist-workflow-api-and-rollout.md). The findings and proposed contracts below are retained as the pre-implementation baseline; use the handoff for current integration behavior.

## 1. Outcome and scope

Deliver a backend in which checklist execution goes through attributable submission and review, Done is terminal, task status is derived from checklist/child work, and authorization follows current relationships. The frontend should integrate against this completed, tested contract rather than compensate for inconsistent server behavior.

The controlling specification is [Task and checklist workflow requirements](../../archkalinga-frontend-v1/docs/task-checklist-workflow-change-requirements.md), especially BE-01–BE-08, section 8 decisions, and AC01–AC22. This plan supersedes conflicting manual completion/reopening assumptions in [the previous status implementation plan](task-status-progress-backend-implementation-plan.md) and branched-card assumptions in [the checklist Kanban plan](checklist-kanban-api-implementation-plan.md). Compatible package, scheduling, hierarchy, and conversation behavior should be reused.

Resources and time tokens remain deferred. Frontend navigation restoration is a frontend responsibility; this backend supplies stable identities and projections. Public-profile joining changes remain a separate product decision and must not delay the core workflow or widen task visibility.

**Recommended sequence:** agree the blocked semantics → establish migrations and retained identity/history → centralize permissions and assignments → implement transactional submissions/transitions → implement derived status and close legacy bypasses → finish read/document/request contracts → verify and publish the frontend handoff → activate through a coordinated rollout.

## 2. Findings confirmed in the local source

These are source observations, not deployment or runtime verification.

| Area | Current implementation | Required work |
| --- | --- | --- |
| Checklist transitions | `task-checklist-transition.service.ts::applyChecklistTransition` sets completion on entry to Done and clears it on exit; branch descendant validation is not a review lifecycle. `task-checklist.service.ts` already locks items for PATCH/move. | Preserve useful transaction/rank code; replace transition rules with the required state/actor matrix and submission effects. |
| Offline bypass | `task-sync-events.service.ts::applyChecklistToggle` directly sets `completed`, actor, and timestamp without the transition service. | Reject legacy completion toggles or translate fully specified new workflow events into the same command service. No boolean-only implicit acceptance. |
| Identity destruction | `task-crud.service.ts::updateTask` deletes all checklist rows when `checklistItems` is supplied, then recreates them. | Replace with identity-preserving edits or reject whole-list replacement once the workflow is active. Otherwise submissions, documents, and branches can disappear. |
| Other task mutation paths | `task-crud.service.ts` contains create/update/move/complete/reopen/bulk/supersede and nested checklist writes; `task-completion-transition.service.ts` supports completion policies. | Audit each path, including creation in Done and descendant auto-completion. Derived task status must have one internal writer. |
| Relationship authority | `task-auth.service.ts` uses task/ancestor creators for management/execution and allows assignee edits; reportee-only item updates are text-only. `canViewTask` still requires generic view permission for ordinary participants. | Evaluate current reportees and task assignees, separate definition changes from execution/review, and remove generic-role prerequisites from eligible relationship actions. Preserve project/workspace boundaries. |
| Guard placement | Checklist PATCH/move rely on service authorization; checklist reads/creation, documents, and other routes also use `ProjectPermissionGuard` and permission decorators. | Review controller and service layers together; changing only `TaskAuthService` is insufficient. Do not weaken unrelated project administration routes. |
| Assignments | Package items persist their own `assignedMembers`; item detail returns that snapshot. Checklist Kanban cards already derive members from task assignees. | One effective source: task assignments on all reads and writes. Preserve independently assigned child tasks. |
| Branching | Direct branching and package branching already set creator/reportee and preserve source links. Several creation inputs still accept statuses, including Done. | Share branch invariants, reject forged initial workflow states, keep explicit child assignees and transaction rollback. |
| Status identity | `ProjectStatus` has `key`, category, `isDone`, `isTerminal`, `completionPolicy`, and `isActive`; category does not uniquely distinguish Progress from Review. | Protect canonical semantics from editable names/order/config changes. Preserve custom column IDs. |
| Rollup | `task-progress.service.ts` computes numerical progress and queries only `packageManaged: true` checklist work; it avoids linked-child double counting. | Add a separate canonical status reducer covering all relevant items and children. Do not derive Review from a percentage or change numerical weighting without a separate requirement. |
| Kanban | `task-query.service.ts::getChecklistKanban` defaults `includeBranched` to true. | Enforce unbranched filtering before pagination/counts even when old callers request branched inclusion. |
| Documents | `TaskDocument.checklistItemId` exists. Replacement upload retains versions, but explicit attachment-list replacement deletes rows and document deletion hard-removes records. Attachment/document/checklist FKs include cascades. | Retain IDs, metadata and versions through all removal paths; add REFERENCE and checklist-scoped authorization. |
| Download access | Document serializer and attachment download endpoint sign URLs. `MinioService.getFileUrl` defaults to 24-hour presigned URLs. | Enforce tombstones at every issuance/download path; address previously issued URLs and shared blob references before promising immediate deletion. |
| Change requests | `resolveTaskChangeRequest` records a decision, message, and audit history separately from task updates. | Preserve this separation; add originating checklist context rather than a second conversation system. |
| Revision support | `AppBaseEntity` already has a TypeORM `version` column. | Reuse deliberately as the client revision if all relevant writes increment/check it; a version column alone does not provide the required compare-and-set behavior. |
| Tests | Service specs and a PostgreSQL task-package integration harness exist. Database tests skip without explicit `TASK_PACKAGE_TEST_PG_HOST`. | Extend them; a green test command with skipped database suites is not acceptance evidence. |

Primary source directories: [task services](../src/tasks/services), [DTOs](../src/tasks/dtos), [serializers](../src/tasks/serializers), [entities](../src/tasks/entities), [migrations](../src/migrations).

## 3. Decisions to settle before affected implementation

Recommendations below are proposals, not newly confirmed product rules. Record the chosen answers and test fixtures in a backend contract before coding dependent behavior. Independent schema/history work can proceed meanwhile.

| Decision | Recommendation / required answer | Blocks |
| --- | --- | --- |
| Mixed canonical status | Minimum effective canonical stage across non-empty work, with Todo < Progress < Review < Done. Thus Todo+Progress → Todo, Progress+Review → Progress, Review+Done → Review. | Reducer and status backfill. |
| Custom states | Retain the last **active** canonical stage; new custom work starts at Todo. Review → custom closes the attempt and should reset effective stage to Progress, not retain Review without an active submission. Explicitly agree this refinement to the source proposal. | Custom transitions and reducer. |
| Withdrawal/regression | Recompute status and permit regression before Done. Preserve terminal Done. | Reducer and withdrawal acceptance tests. |
| Empty/completed structures | New empty task = Todo. Reject adding/reparenting incomplete work below a completed task, including completed ancestors. Define deletion, supersession, unlinking, and legacy empty Done treatment without reopening historical completion. | Structural writes and backfill. |
| Visibility | Specify participant ancestor/descendant/sibling access and unassigned-member access. Preserve existing unrelated visibility restrictions while enabling confirmed participant actions; never infer project-wide visibility. | Unified read policy and final security signoff. |
| Definition editing and branching | Confirm which task/checklist fields assignees may edit and whether higher current reportees may branch/manage descendants. Original creator history must not grant permanent authority after transfer. | Definition/edit/branch policy. |
| Scheduling cascades | Define which date/dependency edits recalculate which descendants. Execution timing/predecessors are advisory; malformed/cyclic/cross-project dependencies remain invalid. | Final warning/cascade contract. |
| Existing In Review records | Inventory them: no historical submission actor/version snapshot can be invented. Proposed remediation: explicit audited return to active and real resubmission, or an explicitly labeled migration state requiring resubmission. | Activation of the one-active-attempt invariant. |
| Legacy assignment/reportee/status conflicts | Agree disposition of ambiguous rows and completed parents with incomplete work. Do not silently rewrite authority, fabricate evidence, or reopen Done. | Data migration approval and activation. |
| Deletion semantics for stored files | Decide whether deletion removes one attachment reference or shared content globally; require immediate unavailability for the deleted attachment. Prefer authorized streaming/proxy access for new URLs. Plan legacy signed-URL retirement. | AC16 and document release readiness. |

Do not impose mandatory rejection notes or mandatory deliverable uploads for submission without a confirmed rule. Support optional notes and snapshot actual available evidence; an empty deliverable definition is not an uploaded version.

## 4. Target design and invariants

### Shared policy and command boundary

Extend `TaskAuthService` or extract a narrowly scoped workflow policy that accepts membership, visibility, current task relationships, item state, and current submission. Use it for capabilities and mutation authorization. Capabilities are hints for the UI; mutations always re-evaluate live state inside the transaction.

Keep project/workspace admission distinct from action grants. Replace generic permission gates only on affected workflow endpoints with context checks plus the shared action policy. Include documents and change-request conversations. Neither a project role nor an administrator can bypass terminal Done or required review.

Use one checklist workflow command service, called by drag, submit, decisions, compatible PATCH adapters, and any supported sync event. Keep task status persistence internal to the rollup service. Explicitly reject client attempts at task status/completion rather than silently ignoring them.

### Persistence additions and reuse

| Record/change | Planned contents and constraints |
| --- | --- |
| Canonical status semantics | Proposed nullable `canonicalStage` on project statuses: TODO, IN_PROGRESS, IN_REVIEW, DONE; custom = null. Unique canonical stage per project, canonical rows active, config endpoints cannot delete/remap an in-use stage. Map existing known keys with an audited inventory; flag ambiguous projects. |
| Checklist submission | Project/task/item IDs, attempt number, submit actor/time, source, outcome, outcome actor/time, base version. Unique `(checklistItemId, attemptNumber)` and partial unique index on checklist ID where outcome = SUBMITTED. Check consistency of terminal outcome fields. |
| Submission evidence | Submission/document/attachment IDs and immutable snapshot of display metadata, scope, version identity, uploader/time. No cascade deletion of referenced evidence. Never snapshot signed download URLs. |
| Review note revisions | Submission, stable logical note ID, revision, author/editor/time and text. Append revisions; do not overwrite history or allow active-note editing to mutate terminal outcomes. |
| Idempotency receipt | Unique actor/project/item/idempotency-key scope shared by drag and explicit commands; normalized command hash and committed response/effect IDs. Same key/different command = conflict. Durable enough to cover offline/network retries. |
| Item workflow metadata | Effective canonical stage for custom states if approved; legacy-completion provenance. Reuse item `version` or introduce explicit workflow revision only if existing version write coverage cannot be guaranteed. |
| Document/version history | REFERENCE type; document and attachment tombstone actor/time; file availability separate from `isActive`; retained definition revisions where edits would otherwise erase metadata. Reuse attachment UUID as version identity and add missing original filename/MIME/size metadata for future uploads. |
| Change request origin | Nullable `checklistItemId`, validated against owning task/project, retained with historical context on archive. |
| Ownership audit | Existing activity log with actor, old/new reportee, parent, reason and timestamp. Preserve creator identity. Enforce valid root reportee in service/offboarding paths and database constraints where feasible. |

Register new entities/providers in `tasks.module.ts` and barrel exports. Use explicit migrations, since database configuration has `synchronize: false`. Do not modify already-applied migrations; allocate unique new migration timestamps and follow existing physical column names.

### Transaction and concurrency protocol

1. Validate request shape and project admission, then enter a transaction. Resolve affected hierarchy and acquire locks in one documented global order shared by transition, assignment, reportee, branching and structural mutations. Revalidate hierarchy after locking. A project-scoped transactional lock is an acceptable initial correctness baseline; optimize only with concurrency evidence.
2. Load current task relationships, checklist, target status, active submission, and evidence references with the same manager. Recheck visibility/action authority; an earlier capability response is not authorization.
3. Check a committed idempotency receipt before stale-revision rejection so a successful request with a lost response can replay safely. Authenticate and recheck read access before returning a receipt. Enforce uniqueness for concurrent identical keys and reject payload mismatch.
4. Compare `expectedRevision` against locked state. Apply the transition matrix. Same-status ordering in Review must not create an attempt; repeated explicit submission with a new key conflicts if already submitted.
5. On submit, snapshot exact deliverable versions atomically relative to document replacement/deletion. On accept/reject/withdraw, close only the active attempt and update checklist state in the same transaction. Require explicit reject/withdraw intent when either meaning is possible.
6. Recompute owning task and ancestors bottom-up using all effective work. Persist changed status/completion metadata, revisions, branch-source projections and audit entries in the same transaction. Include only caller-visible projections in the response; do not leak hidden ancestors through changed-ID lists.
7. Persist the command receipt and any existing outbox events before commit. External notifications/storage cleanup run after commit; failure must not undo or duplicate the workflow operation.

Explicitly test sibling completions racing: locking only each checklist row is insufficient to prevent an incorrect parent rollup. Also test assignment/removal versus acceptance and document replacement versus submission. For sync batches, a caught error must not commit partial command writes; use a rollback boundary per event or reject unsupported workflow events before mutation.

### Transition rules

| Source | Action | Eligible relationship | Effect |
| --- | --- | --- | --- |
| Active | Move to active/custom | Assignee | Status update only. |
| Active | Submit / move to Review | Assignee | New SUBMITTED attempt and evidence snapshot. |
| Active | Move directly to Done | Nobody | `CHECKLIST_REVIEW_REQUIRED`. |
| Review | Accept / move to Done | Current reportee | ACCEPTED + terminal Done. |
| Review | Withdraw to active | Assignee | WITHDRAWN. |
| Review | Reject to active | Current reportee | REJECTED with optional review note. |
| Review | Edit review notes | Current reportee | Append attributable note revision. |
| Done | Leave Done | Nobody | `CHECKLIST_DONE_IS_TERMINAL`. |
| Branched source | Client workflow transition | Nobody | Derived from child task; retain link/history. |

Dual-role users have both sets of actions and may self-approve. No automatic submission/approval occurs during creation. New tasks/items should initialize to the agreed initial stage; legacy creation payloads containing workflow statuses need an explicit compatibility rule and cannot manufacture reviewed completion.

### Rollup algorithm

For a task, collect unbranched owned checklists plus direct child tasks, counting a linked child exactly once. Include non-package-managed items. Resolve child status bottom-up; branched source status mirrors its child and does not create a submission. Use the agreed reducer, with explicit empty-set handling. Do not filter reducer inputs by the caller's visibility.

Recalculate on checklist transitions, creation/archive/removal, branching, child creation/reparenting/deletion/supersession, and relevant migration/configuration changes. Changing assignees/reportee changes capabilities; it does not itself change execution state. Persist automatic completion provenance without inventing a reviewer for task rollups. Preserve the existing numerical progress formula unless separately agreed, while keeping completed tasks consistent with 100% progress.

## 5. Ordered implementation work packages

Each package should be a reviewable change with its stated exit criteria. Transitional code may be inactive until the full workflow is ready; do not expose partially enforced behavior.

| Order | Work package and files | Depends on | Exit criteria |
| --- | --- | --- | --- |
| B0 | Contract and mutation inventory: this plan, new workflow API contract, `tasks.controller.ts`, `tasks.service.ts`, DTOs, project status config. Enumerate all status/completion, structure, and history-deletion writers. Resolve section 3 decisions. | Product answers for affected rules | Signed-off transition/rollup/visibility fixtures; endpoint compatibility table and data audit design. |
| B1 | Additive schema and audit tooling: `src/migrations`, task/document/submission entities, `tasks.module.ts`; dry-run status, ownership, assignment and legacy-state reports. | B0 schema decisions | Empty and populated fixture migrations pass; ambiguous data reported; no fabricated history. |
| B2 | Policy and ownership: `task-auth.service.ts`, guard/decorator wiring, `task-members.service.ts`, `task-crud.service.ts`, package/direct branch paths; membership/offboarding call sites discovered in repository audit. | B1; approved visibility/edit matrix | Relationship-only API tests pass; task assignment is authoritative; child reportee fallback is audited/atomic; roots cannot lose reportee. |
| B3 | Preserve identity and evidence: `task-documents.service.ts`, document DTOs/serializers, `task-crud.service.ts`, `task-checklist.service.ts`, deletion FKs and storage access. | B1–B2 | No destructive list replacement/cascade erases history; exact attachment IDs retained; REFERENCE/scope validated; tombstone download protection tested. |
| B4 | Submission engine: new submission/idempotency/note services and entities; `task-checklist-transition.service.ts`, checklist DTOs, activity logging, new controller/facade endpoints. | B1–B3 | Drag and explicit Submit equivalent; terminal transitions and actor matrix enforced; durable replay and accept/withdraw race tests pass. |
| B5 | Derived status and bypass closure: new `task-status-rollup.service.ts`; `task-progress.service.ts`, `task-completion-transition.service.ts`, CRUD/package/branch/sync/structural entry points. | B4; approved reducer | All owning/ancestor statuses correct; old move/complete/reopen/bulk/sync/create/nested PATCH paths cannot bypass review; concurrent siblings correct. |
| B6 | Read contracts and remaining integration: `task-query.service.ts`, task/detail/list/document serializers, dashboard/field-work/snapshot/tree/Mindmap/Gantt consumers, `task-change-requests.service.ts`, dependency/schedule services. | B2–B5 | Board counts exclude branches, every relevant read has consistent capabilities/revisions, warnings are advisory, checklist-origin conversations work without applying edits. |
| B7 | Verification, backfill rehearsal and frontend handoff: service/HTTP/PostgreSQL tests, OpenAPI docs, sample fixtures, API reference/migration notes and rollout runbook. | B0–B6 | Backend readiness checklist below complete; no unresolved production data blocker. |

Do not defer B3 until after frontend work: submission snapshots and deletion guarantees depend on it. Do not ship B4 with B5's legacy bypasses still reachable.

## 6. Proposed frontend contract to freeze in B0

Paths below are relative to `/projects/:projectId/tasks/:taskId` unless otherwise indicated. Keep the application's existing response wrapper and document the payload inside it. These are planned contracts, not currently available endpoints.

| Endpoint | Contract change |
| --- | --- |
| `GET /projects/:projectId/checklist-kanban` | Unbranched rows only, correct counts, canonical status metadata, task-derived assignments, action capabilities, item revisions. |
| `GET /checklist/:itemId` | Effective assignments/reportee; task and checklist starter scopes; deliverable definitions/versions; constraints/warnings; active submission summary; capabilities and revision. Paginate full history separately. |
| `PATCH /checklist/:itemId/move` | Existing status/order inputs plus `intent`, optional `reviewNote`, `expectedRevision`, `idempotencyKey`. Normalize drag-to-Review to SUBMIT and Review-to-Done to ACCEPT; require explicit WITHDRAW/REJECT for return when ambiguous. Source marker is informational, not authority. |
| `POST /checklist/:itemId/submissions` | `expectedRevision`, `idempotencyKey`, optional submission note; invokes identical SUBMIT command with source = submit. |
| `GET /checklist/:itemId/submissions` | Cursor pagination with deterministic attempt order; outcome actors/times, note revisions and immutable version references, including tombstones. |
| `POST /checklist/:itemId/submissions/:submissionId/decision` | `decision: ACCEPT | REJECT | WITHDRAW`, destination status for return/withdrawal, optional note, expected item revision, idempotency key. Submission must be the active attempt. |
| `PATCH /checklist/:itemId/submissions/:submissionId/notes` | Reviewer-only active-note update, note identity/revision, expected item revision and idempotency key; retains earlier text. |
| `DELETE /reportee` | Child-only fallback to immediate parent's current reportee; version protection and replay behavior documented. Returns new reportee, audit result and changed capabilities. Root removal fails. |
| `POST /projects/:projectId/task-packages` and `POST /checklist/:itemId/branch` | Server creator/reportee; one assignment set per task; explicit child assignment set; initial status validation; existing upload compensation and branch transaction preserved. |
| Existing document endpoints | Add REFERENCE, validated `checklistItemId` create/list scope, retained version/history reads and tombstones; download availability enforced server-side. Provide an explicit version-file deletion operation if existing document deletion cannot express it. |
| Existing change-request endpoints | Add optional validated checklist origin and context on create/read/filter; preserve task-level conversations and separate resolution from editing. |
| Task mutation endpoints | Reject manual workflow changes with `TASK_STATUS_IS_DERIVED`; allow separately authorized non-workflow task edits. Specify whether legacy same-value fields are rejected or accepted as no-ops. |

Before handoff, publish concrete JSON examples for successful submit/accept/withdraw, retry, stale conflict, deleted evidence, branch response, and reportee fallback. Recommended mutation payload shape inside the existing wrapper:

```json
{
  "item": { "id": "<uuid>", "statusId": "<uuid>", "revision": 8 },
  "submissionEffect": { "id": "<uuid>", "attemptNumber": 2, "outcome": "SUBMITTED" },
  "changedTasks": [{ "id": "<uuid>", "statusId": "<uuid>", "revision": 13 }],
  "changedChecklistItems": [{ "id": "<uuid>", "revision": 8 }],
  "capabilities": {
    "allowedTargetStatusIds": ["<uuid>"],
    "canSubmit": false,
    "canWithdraw": true,
    "canReview": false,
    "canEditSubmissionNotes": false,
    "canUploadDeliverables": true
  },
  "warnings": [],
  "replayed": false
}
```

The example is illustrative, not an exhaustive schema. Include `canManageAssignees`, `canRemoveReportee`, definition/document permissions and `canBranch` on the relevant task/item reads. Define capability action details for dual-role return intent rather than depending only on allowed targets. Changed records must include status/completion fields or clearly require refetch, and revisions must be monotonic for the represented changes. A replay may return the original committed outcome plus an instruction to refresh current state; never run the command again to recover a failed read.

Errors: 403 for forbidden actions; 409 for invalid current state, terminal Done, active submission, stale revision and derived task overrides; 400/422 for malformed or invalid references; 404 for missing/inaccessible resources according to the agreed visibility policy. Document `FILE_CONTENT_DELETED` (recommended 410 for a visible tombstone), `ROOT_REPORTEE_CANNOT_BE_REMOVED`, `CHECKLIST_REVIEW_REQUIRED`, `CHECKLIST_TRANSITION_FORBIDDEN`, `CHECKLIST_ALREADY_SUBMITTED`, `STALE_WORKFLOW_REVISION`, and idempotency-key mismatch. Conflict responses may contain only state the actor is permitted to read.

## 7. Migration and rollout plan

1. **Inventory without mutation.** Produce per-project reports for canonical mapping, missing reportees, assignment differences, branched/legacy items, existing Review and Done, contradictory completion/status, dangling document links, hard-delete cascades and completed ancestors containing unfinished work. Existing hard-deleted history is unrecoverable without independent backups; do not manufacture it.
2. **Expand schema.** Add new tables/nullable fields/indexes and history-retention constraints with explicit migration tests. Keep old columns temporarily for compatible reads, but stop treating checklist assignment snapshots as authority. Existing attachment UUIDs remain stable.
3. **Repair and preview.** Apply approved mapping/ownership repairs with old/new values and reason. Resolve legacy Review without fictional submissions. Label valid historical completion as legacy. Preserve actual branch tasks and original creators. Preview status backfill differences before writing them.
4. **Deploy complete backend support to staging.** Use fixtures and an isolated PostgreSQL database. Validate the full contract before inviting frontend integration. If production needs phased activation, implement one coherent workflow gate applied to all writers/read contracts, not separate partial switches.
5. **Backfill and activate.** Quiesce affected workflow writes or use an equivalent controlled activation boundary while final inventory/backfill runs. Recheck reports under that boundary, activate enforcement, then enable the compatible frontend. Old clients must receive explicit upgrade/conflict behavior and cannot retain privileged bypasses. Backend can deploy first, but old UI actions will fail after activation until the UI update is deployed.
6. **Document signed-URL cutover.** New protected download access must check each request. Retire legacy URL issuance and wait out the previously issued URL lifetime or invalidate legacy object access using a tested storage migration that preserves live shared references. Metadata-only deletion is not fully enforced while a deleted attachment's old signed URL still works.
7. **Rollback safely.** Before activation, additive schema may be rolled back only when unused and tested. After real submissions/history exist, preserve schema and history; pause affected writes or roll forward to a compatible backend. Reverting to old code that reopens work or cascades deletes is not a safe rollback.

Capture migration counts, conflicts, invariant failures, command replay/latency, and rollup discrepancies during rollout. Avoid logging submission/file contents in operational diagnostics.

## 8. Verification and acceptance mapping

Tests must cover HTTP guards as well as domain services; mock-only service tests cannot establish row-lock, partial-unique-index or rollback correctness.

| Required tests | Requirements/acceptance covered |
| --- | --- |
| Relationship/actor matrix: assignee, reportee, dual role, old creator after fallback, ancestor, ordinary member, admin, revoked member, wrong project/workspace. Include actual controller guards. | BE-01/02; AC01–03, AC10–11, AC21. |
| Active → Review through drag and submit; same-key retries, different payload reuse, duplicate active submission, same-status reorder, optional notes, withdrawal and resubmission. | BE-03/04; AC04–06, AC22 backend contribution. |
| PostgreSQL races: accept versus withdraw, duplicate submits, sibling accepts, reportee/assignee changes versus command, evidence replacement versus submit, failed command atomicity. | BE-03–05; AC07, AC12, AC16. |
| Bypass suite: item PATCH/completed flag, task create/update/nested list/bulk/move/complete/reopen, completion policies, package/direct branch creation, offline sync, structural edits under Done. | BE-04/05; AC08, AC09. |
| Reducer truth table: unanimous stages, mixed pairs, all custom/custom+Done, withdrawal regression, empty task/child, legacy non-package items, linked and unlinked children, deep ancestors, hidden work. | BE-05; AC12–14. |
| Board/read agreement: branch exclusion despite query flag, counts/pagination, visibility, effective assignments, consistent canonical state/revisions/capabilities across detail/list/tree/dashboard/projections. | BE-01/02/06; AC09–10, AC15, AC20 backend contribution, AC21. |
| Evidence retention: replacement and explicit attachment list update, version and document delete, checklist/task archive/delete, starter-from-deliverable sharing, deleted URL enforcement, original version snapshot and metadata revisions. | BE-07; AC16–17. |
| Advisory constraints: early dates/incomplete predecessors do not block commands; malformed/cyclic/cross-project dependencies still fail. Conversation resolution does not alter task fields; authorized later save returns agreed cascades. | BE-08; AC18–19. |
| Migration rehearsal: old/new populated fixtures, no invented submissions, legacy Done retained, ambiguous statuses/review/reportees reported, repeatable backfill, preservation after failed deployment. | Migration requirements; AC08, AC11–17. |

Start with `npm run build` and targeted service/DTO specs, then run the complete relevant Jest suites and HTTP integration suites. Use the existing explicit PostgreSQL test environment pattern; ensure database tests actually execute. Run migrations against a disposable database through the real migration chain in addition to entity-based fixtures. Run non-mutating lint checks explicitly (`npm run lint` currently includes `--fix`). Update obsolete tests that assert reopening/manual descendant completion. Update package/scheduling smoke consumers if present and affected; do not test through live workspace mutations.

AC20's view/tab/scroll restoration and AC22's refresh-failure UI behavior require frontend tests later. Backend readiness covers stable identities, safe replay and authoritative refetch contracts, not those UI outcomes.

## 9. Backend readiness gate for frontend implementation

Frontend integration should begin against the backend only after all of the following are available:

- [ ] Section 3 workflow, visibility and migration decisions are recorded; no silent assumptions remain in the reducer.
- [ ] Migrations and backfill dry-run reports are reviewed; staging data satisfies ownership, canonical status and active-submission invariants.
- [ ] All lifecycle endpoints and controller policies work for users without extra generic role grants.
- [ ] Creation, PATCH, bulk, sync, completion policies and structural operations cannot bypass the workflow.
- [ ] All reads expose consistent assignments, canonical status, revisions and action capabilities; Checklist Kanban excludes branches before counts/pagination.
- [ ] Document categories, retained versions, submission references, tombstones and protected download behavior are complete.
- [ ] Checklist-origin conversations and advisory warnings are complete.
- [ ] OpenAPI/request-response examples and frontend migration notes are published, including breaking legacy behavior and exact response wrapper.
- [ ] PostgreSQL concurrency, migration and HTTP authorization checks pass without skipped required suites.
- [ ] A seeded staging scenario covers submit → withdraw → resubmit → reject → resubmit → accept, branching/ancestor completion, reportee fallback and deleted evidence.
- [ ] Frontend handoff identifies affected caches/projections, retry handling, upgrade requirements and coordinated activation/rollback procedure.

The frontend can then implement its Task/Checklist modes, dedicated checklist view, capability-driven actions, creation payload changes, document history, conversations and navigation against a stable backend. This planning change does not claim those endpoints or guarantees are implemented.

## 10. Analysis validation

This plan was checked against local source, migrations, DTOs, guards, serializers and the existing test harness. Application tests and migrations were not run because only this documentation was added. The next implementation step is B0: settle the listed semantics and publish exact workflow contracts, while preparing additive migration/history work that does not depend on unresolved product choices.
