import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskStatusCompletionSemantics1789600000000 implements MigrationInterface {
  name = 'AddTaskStatusCompletionSemantics1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_statuses"
        ADD COLUMN IF NOT EXISTS "isDone" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "project_statuses"
        ADD COLUMN IF NOT EXISTS "completionPolicy" varchar(40) NOT NULL DEFAULT 'none'
    `);

    await queryRunner.query(`
      UPDATE "project_statuses"
      SET
        "category" = CASE
          WHEN "key" = 'blocked' THEN 'blocked'
          WHEN "category" IN ('todo', 'not_started') THEN 'not_started'
          WHEN "category" IN ('in_progress', 'active') THEN 'active'
          WHEN "category" = 'done' THEN 'done'
          ELSE "category"
        END,
        "isDone" = CASE
          WHEN "category" = 'done' OR "key" = 'done' THEN true
          ELSE "isDone"
        END,
        "isTerminal" = CASE
          WHEN "category" = 'done' OR "key" = 'done' THEN true
          ELSE "isTerminal"
        END,
        "completionPolicy" = CASE
          WHEN "category" = 'done' OR "key" = 'done'
            THEN 'complete_open_work_items'
          ELSE "completionPolicy"
        END
    `);

    await queryRunner.query(`
      ALTER TABLE "project_statuses"
        ALTER COLUMN "category" SET DEFAULT 'active'
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "completed_by_user_id" uuid
    `);

    await queryRunner.query(`
      UPDATE "tasks"
      SET "completed_at" = COALESCE("completed_at", "updatedAt")
      WHERE "completed" = true
        AND "completed_at" IS NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_tasks_completed_by_user_id'
        ) THEN
          ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_tasks_completed_by_user_id"
            FOREIGN KEY ("completed_by_user_id")
            REFERENCES "users"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_statuses_project_done"
        ON "project_statuses" ("projectId", "isDone")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_completed_by_user_id"
        ON "tasks" ("completed_by_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tasks_completed_by_user_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_project_statuses_project_done"
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
        DROP CONSTRAINT IF EXISTS "FK_tasks_completed_by_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
        DROP COLUMN IF EXISTS "completed_by_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
        DROP COLUMN IF EXISTS "completed_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "project_statuses"
        ALTER COLUMN "category" SET DEFAULT 'in_progress'
    `);
    await queryRunner.query(`
      UPDATE "project_statuses"
      SET "category" = CASE
        WHEN "category" = 'not_started' THEN 'todo'
        WHEN "category" = 'active' THEN 'in_progress'
        WHEN "category" = 'blocked' THEN 'in_progress'
        ELSE "category"
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "project_statuses"
        DROP COLUMN IF EXISTS "completionPolicy"
    `);
    await queryRunner.query(`
      ALTER TABLE "project_statuses"
        DROP COLUMN IF EXISTS "isDone"
    `);
  }
}
