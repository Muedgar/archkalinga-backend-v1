import { MigrationInterface, QueryRunner } from 'typeorm';
/** Classify only canonical keys shipped by this repository; never infer from labels. */
export class ClassifyChecklistWorkflow1790000001000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE workflow_migration_audit (id bigserial PRIMARY KEY, project_id uuid, entity_id uuid, operation text NOT NULL, snapshot jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(`INSERT INTO workflow_migration_audit(project_id, entity_id, operation, snapshot)
      SELECT "projectId", id, 'STATUS_CLASSIFICATION', to_jsonb(s) FROM project_statuses s WHERE key IN ('todo','in_progress','in_review','done')`);
    await q.query(`UPDATE project_statuses SET canonical_stage = CASE key WHEN 'todo' THEN 'TODO' WHEN 'in_progress' THEN 'IN_PROGRESS' WHEN 'in_review' THEN 'IN_REVIEW' WHEN 'done' THEN 'DONE' END,
      "completionPolicy" = 'none' WHERE key IN ('todo','in_progress','in_review','done')`);
    await q.query(`INSERT INTO workflow_migration_audit(project_id, entity_id, operation, snapshot)
      SELECT t."projectId", i.id, 'CHECKLIST_CLASSIFICATION', to_jsonb(i) FROM task_checklist_items i JOIN tasks t ON t.id = i."taskId"`);
    await q.query(`UPDATE task_checklist_items i SET effective_stage = CASE WHEN i.completed THEN 'DONE' ELSE COALESCE(s.canonical_stage,'TODO') END, legacy_completion = i.completed
      FROM project_statuses s WHERE s.id = i.status_id`);
    // Migration event is not a fabricated user submission or rejection.
    await q.query(`INSERT INTO workflow_migration_audit(project_id, entity_id, operation, snapshot)
      SELECT t."projectId", i.id, 'LEGACY_REVIEW_RETURNED_FOR_RESUBMISSION', to_jsonb(i)
      FROM task_checklist_items i JOIN tasks t ON t.id = i."taskId"
      WHERE i.effective_stage = 'IN_REVIEW' AND NOT i.completed AND i.branched_task_id IS NULL`);
    await q.query(`UPDATE task_checklist_items i SET status_id = s.id, effective_stage = 'IN_PROGRESS', version = i.version + 1
      FROM tasks t JOIN project_statuses s ON s."projectId" = t."projectId" AND s.canonical_stage = 'IN_PROGRESS' AND s."isActive"
      WHERE i."taskId" = t.id AND i.effective_stage = 'IN_REVIEW' AND NOT i.completed AND i.branched_task_id IS NULL`);
    await q.query(`UPDATE task_checklist_items i SET assigned_members = COALESCE((
      SELECT jsonb_agg(jsonb_build_object('userId', a."userId", 'projectRoleId', a."projectRoleId")) FROM task_assignees a WHERE a."taskId" = i."taskId"
    ), '[]'::jsonb), reportee_user_id = t."reporteeUserId" FROM tasks t WHERE t.id = i."taskId"`);
    await q.query(`INSERT INTO workflow_migration_audit(project_id, entity_id, operation, snapshot)
      SELECT "projectId", id, 'RESTORE_CREATOR_REPORTEE', to_jsonb(t) FROM tasks t WHERE "reporteeUserId" IS NULL AND "createdByUserId" IS NOT NULL
      AND EXISTS(SELECT 1 FROM project_memberships m WHERE m."projectId" = t."projectId" AND m."userId" = t."createdByUserId" AND m.status = 'ACTIVE')`);
    await q.query(`UPDATE tasks t SET "reporteeUserId" = t."createdByUserId", reportee_user_id = (SELECT u.pkid FROM users u WHERE u.id = t."createdByUserId"), version = version + 1 WHERE "reporteeUserId" IS NULL
      AND EXISTS(SELECT 1 FROM project_memberships m WHERE m."projectId" = t."projectId" AND m."userId" = t."createdByUserId" AND m.status = 'ACTIVE')`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Audited workflow classification must be rolled forward; do not recreate unrecorded Review states.',
      ),
    );
  }
}
