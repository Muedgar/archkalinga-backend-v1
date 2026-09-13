import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeferChecklistBranching1789800000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE task_checklist_items
      ADD COLUMN description jsonb,
      ADD COLUMN package_managed boolean NOT NULL DEFAULT false,
      ADD COLUMN legacy_branch boolean NOT NULL DEFAULT false,
      ADD COLUMN assigned_members jsonb NOT NULL DEFAULT '[]',
      ADD COLUMN reportee_user_id uuid,
      ADD COLUMN duration_days numeric(10,2) NOT NULL DEFAULT 1,
      ADD COLUMN earliest_start_date date,
      ADD COLUMN planned_start_date date,
      ADD COLUMN planned_end_date date`);
    await q.query(`ALTER TABLE task_documents ADD COLUMN checklist_item_id uuid
      REFERENCES task_checklist_items(id) ON DELETE CASCADE`);
    await q.query(
      `CREATE INDEX idx_task_documents_checklist ON task_documents(checklist_item_id)`,
    );
    await q.query(`CREATE TABLE checklist_dependencies (
      pkid serial PRIMARY KEY, id uuid NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
      version integer NOT NULL DEFAULT 1, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
      checklist_item_id uuid NOT NULL REFERENCES task_checklist_items(id) ON DELETE CASCADE,
      depends_on_checklist_item_id uuid NOT NULL REFERENCES task_checklist_items(id) ON DELETE CASCADE,
      dependency_type varchar(2) NOT NULL DEFAULT 'FS' CHECK (dependency_type IN ('FS','SS','FF','SF')),
      lag_days integer NOT NULL DEFAULT 0,
      UNIQUE(checklist_item_id, depends_on_checklist_item_id), CHECK(checklist_item_id <> depends_on_checklist_item_id))`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_task_checklist_items_branched_task_unique
      ON task_checklist_items(branched_task_id) WHERE branched_task_id IS NOT NULL`);
    // Preserve every pre-existing branch, its child identity, documents, dependencies and history.
    // Capture an immutable inventory before backfilling display metadata. Never detach children.
    await q.query(`CREATE TABLE checklist_legacy_branch_records (
      checklist_item_id uuid PRIMARY KEY, owner_task_id uuid NOT NULL, branched_task_id uuid NOT NULL,
      inventoried_at timestamptz NOT NULL DEFAULT now(), automatically_created boolean NOT NULL,
      disposition text NOT NULL DEFAULT 'RETAINED_LINK', snapshot jsonb NOT NULL)`);
    await q.query(`INSERT INTO checklist_legacy_branch_records (checklist_item_id, owner_task_id, branched_task_id, automatically_created, snapshot)
      SELECT i.id, i."taskId", t.id,
        EXISTS (SELECT 1 FROM task_activity_logs a WHERE a."taskId" = t.id AND a."actionMeta"->>'packageParentTaskId' = i."taskId"::text),
        jsonb_build_object('checklist', to_jsonb(i), 'task', to_jsonb(t), 'schedule', to_jsonb(s),
          'documents', (SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]') FROM task_documents d WHERE d.task_id = t.id),
          'dependencies', (SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]') FROM task_dependencies e WHERE e."taskId" = t.id OR e."dependsOnTaskId" = t.id))
      FROM task_checklist_items i JOIN tasks t ON t.id = i.branched_task_id
      LEFT JOIN task_activity_schedules s ON s.task_id = t.id`);
    await q.query(`UPDATE task_checklist_items i SET
      legacy_branch = true, description = COALESCE(i.description, t.description),
      duration_days = COALESCE(s.duration_days, 1), earliest_start_date = s.earliest_start_date,
      planned_start_date = s.planned_start_date, planned_end_date = s.planned_end_date,
      reportee_user_id = t."reporteeUserId"
      FROM tasks t LEFT JOIN task_activity_schedules s ON s.task_id = t.id
      WHERE i.branched_task_id = t.id`);
  }

  async down(q: QueryRunner): Promise<void> {
    const rows: { used: boolean }[] =
      (await q.query(`SELECT EXISTS(SELECT 1 FROM task_checklist_items WHERE package_managed)
      OR EXISTS(SELECT 1 FROM task_documents WHERE checklist_item_id IS NOT NULL) AS used`)) as {
        used: boolean;
      }[];
    if (rows[0]?.used)
      throw new Error(
        'Cannot revert checklist storage while it contains package data. Export/migrate the data first.',
      );
    await q.query(`DROP TABLE checklist_dependencies`);
    await q.query(`DROP TABLE checklist_legacy_branch_records`);
    await q.query(`ALTER TABLE task_documents DROP COLUMN checklist_item_id`);
    await q.query(`ALTER TABLE task_checklist_items DROP COLUMN description, DROP COLUMN package_managed,
      DROP COLUMN legacy_branch, DROP COLUMN assigned_members, DROP COLUMN reportee_user_id,
      DROP COLUMN duration_days, DROP COLUMN earliest_start_date, DROP COLUMN planned_start_date, DROP COLUMN planned_end_date`);
  }
}
