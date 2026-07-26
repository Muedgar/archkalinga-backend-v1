import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskSupersessionConstraints1789100000000 implements MigrationInterface {
  name = 'AddTaskSupersessionConstraints1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_tasks_superseded_by_task_unique"
        ON "tasks" ("superseded_by_task_id")
        WHERE "superseded_by_task_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_tasks_supersedes_task_unique"
        ON "tasks" ("supersedes_task_id")
        WHERE "supersedes_task_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tasks_supersedes_task_unique"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tasks_superseded_by_task_unique"
    `);
  }
}
