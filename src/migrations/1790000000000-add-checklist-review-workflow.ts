import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive storage. Data classification and activation are deliberately separate. */
export class AddChecklistReviewWorkflow1790000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TYPE task_documents_type_enum ADD VALUE IF NOT EXISTS 'REFERENCE'`,
    );
    await q.query(`ALTER TABLE project_statuses ADD COLUMN canonical_stage varchar(20)
      CHECK (canonical_stage IN ('TODO','IN_PROGRESS','IN_REVIEW','DONE'))`);
    await q.query(
      `CREATE UNIQUE INDEX uq_project_canonical_stage ON project_statuses("projectId", canonical_stage) WHERE canonical_stage IS NOT NULL`,
    );
    await q.query(`ALTER TABLE task_checklist_items ADD COLUMN effective_stage varchar(20) NOT NULL DEFAULT 'TODO',
      ADD COLUMN legacy_completion boolean NOT NULL DEFAULT false`);
    for (const table of ['task_documents', 'task_document_attachments']) {
      await q.query(
        `ALTER TABLE ${table} ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by_user_id uuid`,
      );
    }
    await q.query(
      `ALTER TABLE task_document_attachments ADD COLUMN original_name text, ADD COLUMN mime_type text, ADD COLUMN size_bytes bigint`,
    );
    await q.query(
      `ALTER TABLE change_requests ADD COLUMN checklist_item_id uuid REFERENCES task_checklist_items(id) ON DELETE RESTRICT`,
    );
    const base = `pkid serial PRIMARY KEY, id uuid UNIQUE NOT NULL DEFAULT uuid_generate_v4(), version integer NOT NULL DEFAULT 1,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()`;
    await q.query(`CREATE TABLE checklist_submissions (${base},
      "projectId" uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      "taskId" uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
      "checklistItemId" uuid NOT NULL REFERENCES task_checklist_items(id) ON DELETE RESTRICT,
      "attemptNumber" integer NOT NULL CHECK ("attemptNumber" > 0),
      "submittedByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "submittedAt" timestamptz NOT NULL, source varchar NOT NULL CHECK (source IN ('drag','submit')),
      outcome varchar NOT NULL DEFAULT 'SUBMITTED' CHECK (outcome IN ('SUBMITTED','WITHDRAWN','REJECTED','ACCEPTED')),
      "outcomeByUserId" uuid REFERENCES users(id) ON DELETE RESTRICT, "outcomeAt" timestamptz, "submissionNote" text,
      CONSTRAINT ck_submission_outcome CHECK ((outcome = 'SUBMITTED' AND "outcomeByUserId" IS NULL AND "outcomeAt" IS NULL)
        OR (outcome <> 'SUBMITTED' AND "outcomeByUserId" IS NOT NULL AND "outcomeAt" IS NOT NULL)))`);
    await q.query(
      `CREATE UNIQUE INDEX uq_checklist_submission_attempt ON checklist_submissions("checklistItemId", "attemptNumber")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_checklist_active_submission ON checklist_submissions("checklistItemId") WHERE outcome = 'SUBMITTED'`,
    );
    await q.query(`CREATE TABLE checklist_submission_evidence (${base},
      "submissionId" uuid NOT NULL REFERENCES checklist_submissions(id) ON DELETE RESTRICT,
      "documentId" uuid NOT NULL REFERENCES task_documents(id) ON DELETE RESTRICT,
      "attachmentId" uuid NOT NULL REFERENCES task_document_attachments(id) ON DELETE RESTRICT, snapshot jsonb NOT NULL)`);
    await q.query(
      `CREATE UNIQUE INDEX uq_submission_attachment ON checklist_submission_evidence("submissionId", "attachmentId")`,
    );
    await q.query(`CREATE TABLE checklist_review_notes (${base},
      "submissionId" uuid NOT NULL REFERENCES checklist_submissions(id) ON DELETE RESTRICT,
      "noteId" uuid NOT NULL, revision integer NOT NULL CHECK (revision > 0),
      "authorUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, text text NOT NULL)`);
    await q.query(
      `CREATE UNIQUE INDEX uq_review_note_revision ON checklist_review_notes("noteId", revision)`,
    );
    await q.query(`CREATE TABLE checklist_workflow_receipts (${base},
      "projectId" uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      "checklistItemId" uuid NOT NULL REFERENCES task_checklist_items(id) ON DELETE RESTRICT,
      "actorUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "idempotencyKey" varchar(128) NOT NULL, "commandHash" varchar NOT NULL, response jsonb NOT NULL)`);
    await q.query(
      `CREATE UNIQUE INDEX uq_workflow_receipt ON checklist_workflow_receipts("projectId", "checklistItemId", "actorUserId", "idempotencyKey")`,
    );
    await q.query(`CREATE TABLE task_document_revisions (${base},
      "documentId" uuid NOT NULL REFERENCES task_documents(id) ON DELETE RESTRICT,
      "actorUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, snapshot jsonb NOT NULL)`);
    await q.query(`CREATE TABLE task_workflow_receipts (${base}, "taskId" uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
      "actorUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, "idempotencyKey" varchar(128) NOT NULL, "commandHash" varchar NOT NULL, response jsonb NOT NULL)`);
    await q.query(
      `CREATE UNIQUE INDEX uq_task_workflow_receipt ON task_workflow_receipts("taskId", "actorUserId", "idempotencyKey")`,
    );
    // Replace existing destructive document FKs without relying on generated names.
    for (const [table, column, target] of [
      ['task_documents', 'checklist_item_id', 'task_checklist_items'],
      ['task_documents', 'task_id', 'tasks'],
      ['task_document_attachments', 'document_id', 'task_documents'],
    ]) {
      const constraints = await q.manager.query<{ conname: string }[]>(
        `SELECT c.conname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = $1::regclass AND c.contype = 'f' AND a.attname = $2`,
        [table, column],
      );
      for (const { conname } of constraints)
        await q.query(
          `ALTER TABLE "${table}" DROP CONSTRAINT "${conname.replace(/"/g, '""')}"`,
        );
      await q.query(
        `ALTER TABLE ${table} ADD CONSTRAINT "fk_history_${table}_${column}" FOREIGN KEY (${column}) REFERENCES ${target}(id) ON DELETE RESTRICT`,
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.manager.query<
      { used: boolean }[]
    >(`SELECT EXISTS(SELECT 1 FROM checklist_submissions)
      OR EXISTS(SELECT 1 FROM task_document_revisions)
      OR EXISTS(SELECT 1 FROM task_documents WHERE deleted_at IS NOT NULL OR type::text = 'REFERENCE')
      OR EXISTS(SELECT 1 FROM task_document_attachments WHERE deleted_at IS NOT NULL) AS used`);
    if (row.used)
      throw new Error(
        'Workflow history exists; preserve schema and roll forward instead of discarding evidence.',
      );
    for (const table of [
      'task_workflow_receipts',
      'checklist_workflow_receipts',
      'checklist_review_notes',
      'checklist_submission_evidence',
      'checklist_submissions',
      'task_document_revisions',
    ])
      await q.query(`DROP TABLE ${table}`);
    await q.query(`ALTER TABLE change_requests DROP COLUMN checklist_item_id`);
    await q.query(
      `ALTER TABLE task_checklist_items DROP COLUMN effective_stage, DROP COLUMN legacy_completion`,
    );
    await q.query(`ALTER TABLE project_statuses DROP COLUMN canonical_stage`);
    for (const table of ['task_documents', 'task_document_attachments'])
      await q.query(
        `ALTER TABLE ${table} DROP COLUMN deleted_at, DROP COLUMN deleted_by_user_id`,
      );
    await q.query(
      `ALTER TABLE task_document_attachments DROP COLUMN original_name, DROP COLUMN mime_type, DROP COLUMN size_bytes`,
    );
    // Keep REFERENCE enum value and protective RESTRICT FKs: neither loses data.
  }
}
