import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add indexes used by GET /projects/:projectId/tasks/:taskId.
 */
export class OptimizeTaskDetailFetch1786200000000 implements MigrationInterface {
  name = 'OptimizeTaskDetailFetch1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_id_projectId_deletedAt"
        ON "tasks" ("id", "projectId", "deletedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_parentTaskId_deletedAt"
        ON "tasks" ("parentTaskId", "deletedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_assignees_taskId"
        ON "task_assignees" ("taskId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_checklist_items_taskId_orderIndex"
        ON "task_checklist_items" ("taskId", "orderIndex")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_comments_taskId_deletedAt_createdAt"
        ON "task_comments" ("taskId", "deletedAt", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_dependencies_taskId"
        ON "task_dependencies" ("taskId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_labels_taskId"
        ON "task_labels" ("taskId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_view_metadata_taskId"
        ON "task_view_metadata" ("taskId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_task_view_metadata_taskId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_task_labels_taskId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_task_dependencies_taskId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_task_comments_taskId_deletedAt_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_task_checklist_items_taskId_orderIndex"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_task_assignees_taskId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tasks_parentTaskId_deletedAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tasks_id_projectId_deletedAt"`);
  }
}
