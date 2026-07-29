import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectionPerformanceIndexes1789400000000 implements MigrationInterface {
  name = 'AddProjectionPerformanceIndexes1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_project_parent_active_sort"
        ON "tasks" ("projectId", "parentTaskId", "wbsSortKey", "createdAt")
        WHERE "deletedAt" IS NULL AND "superseded_by_task_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_dependencies_dependsOnTaskId"
        ON "task_dependencies" ("dependsOnTaskId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_locations_active_task"
        ON "task_locations" ("task_id")
        WHERE "is_active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_task_locations_active_task"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_task_dependencies_dependsOnTaskId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_tasks_project_parent_active_sort"`,
    );
  }
}
