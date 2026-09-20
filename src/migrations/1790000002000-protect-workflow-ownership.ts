import { MigrationInterface, QueryRunner } from 'typeorm';
export class ProtectWorkflowOwnership1790000002000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE task_workflow_activation (project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, activated_at timestamptz)`,
    );
    await q.query(
      `INSERT INTO task_workflow_activation(project_id) SELECT id FROM projects`,
    );
    await q.query(
      `ALTER TABLE tasks ADD CONSTRAINT ck_task_reportee_required CHECK ("deletedAt" IS NOT NULL OR "reporteeUserId" IS NOT NULL) NOT VALID`,
    );
    // The relation FK uses a legacy integer user key; retain it rather than silently nulling it on account deletion.
    const rows = await q.manager.query<
      { conname: string }[]
    >(`SELECT c.conname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.conrelid='tasks'::regclass AND c.contype='f' AND a.attname='reportee_user_id'`);
    for (const row of rows)
      await q.query(
        `ALTER TABLE tasks DROP CONSTRAINT "${row.conname.replace(/"/g, '""')}"`,
      );
    await q.query(
      `ALTER TABLE tasks ADD CONSTRAINT fk_task_reportee_retained FOREIGN KEY (reportee_user_id) REFERENCES users(pkid) ON DELETE RESTRICT`,
    );
    await q.query(`CREATE FUNCTION protect_reportee_membership() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR NEW.status::text <> 'ACTIVE' THEN
          IF EXISTS(SELECT 1 FROM tasks WHERE "projectId"=OLD."projectId" AND "reporteeUserId"=OLD."userId" AND "deletedAt" IS NULL) THEN
            RAISE EXCEPTION 'REPORTEE_OFFBOARDING_REQUIRES_RESOLUTION' USING ERRCODE='23514';
          END IF;
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER protect_reportee_membership BEFORE UPDATE OF status OR DELETE ON project_memberships FOR EACH ROW EXECUTE FUNCTION protect_reportee_membership()`,
    );
    await q.query(`CREATE FUNCTION protect_reportee_account() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT NEW.status AND EXISTS(SELECT 1 FROM tasks WHERE "reporteeUserId"=OLD.id AND "deletedAt" IS NULL) THEN
          RAISE EXCEPTION 'REPORTEE_OFFBOARDING_REQUIRES_RESOLUTION' USING ERRCODE='23514';
        END IF; RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER protect_reportee_account BEFORE UPDATE OF status ON users FOR EACH ROW EXECUTE FUNCTION protect_reportee_account()`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER protect_reportee_account ON users`);
    await q.query(`DROP FUNCTION protect_reportee_account()`);
    await q.query(
      `DROP TRIGGER protect_reportee_membership ON project_memberships`,
    );
    await q.query(`DROP FUNCTION protect_reportee_membership()`);
    await q.query(
      `ALTER TABLE tasks DROP CONSTRAINT ck_task_reportee_required`,
    );
    await q.query(`DROP TABLE task_workflow_activation`);
  }
}
