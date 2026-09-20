import { MigrationInterface, QueryRunner } from 'typeorm';
/** Existing task log entity writes projectId but the historical table omitted it. */
export class CompleteWorkflowAuditMapping1790000003000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE task_activity_logs ADD COLUMN IF NOT EXISTS "projectId" uuid`,
    );
    await q.query(
      `UPDATE task_activity_logs a SET "projectId"=t."projectId" FROM tasks t WHERE a."taskId"=t.id AND a."projectId" IS NULL`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_task_activity_project ON task_activity_logs("projectId")`,
    );
  }
  async down(): Promise<void> {
    /* Retain audit context on rollback. */
  }
}
