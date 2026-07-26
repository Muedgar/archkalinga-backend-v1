import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecursiveTaskFoundation1788900000000 implements MigrationInterface {
  name = 'AddRecursiveTaskFoundation1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "superseded_by_task_id" uuid,
        ADD COLUMN IF NOT EXISTS "supersedes_task_id" uuid,
        ADD COLUMN IF NOT EXISTS "supersession_reason" text,
        ADD COLUMN IF NOT EXISTS "superseded_at" timestamptz
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        ALTER TABLE "tasks"
          ADD CONSTRAINT "FK_tasks_superseded_by_task"
          FOREIGN KEY ("superseded_by_task_id") REFERENCES "tasks" ("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        ALTER TABLE "tasks"
          ADD CONSTRAINT "FK_tasks_supersedes_task"
          FOREIGN KEY ("supersedes_task_id") REFERENCES "tasks" ("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_superseded_by_task"
        ON "tasks" ("superseded_by_task_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_supersedes_task"
        ON "tasks" ("supersedes_task_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_wbs_codes" (
        "pkid" serial NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "project_id" uuid NOT NULL,
        "task_id" uuid,
        "wbs_code" varchar(100) NOT NULL,
        "wbs_sort_key" varchar(500) NOT NULL,
        "assigned_by_user_id" uuid,
        CONSTRAINT "UQ_task_wbs_codes_id" UNIQUE ("id"),
        CONSTRAINT "UQ_task_wbs_codes_project_code" UNIQUE ("project_id", "wbs_code"),
        CONSTRAINT "PK_task_wbs_codes" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_wbs_codes_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_wbs_codes_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_task_wbs_codes_assigned_by_user" FOREIGN KEY ("assigned_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_wbs_codes_project_code_unique"
        ON "task_wbs_codes" ("project_id", "wbs_code")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_wbs_codes_task"
        ON "task_wbs_codes" ("task_id")
    `);

    await queryRunner.query(`
      INSERT INTO "task_wbs_codes" (
        "project_id",
        "task_id",
        "wbs_code",
        "wbs_sort_key",
        "assigned_by_user_id"
      )
      SELECT
        task."projectId",
        task."id",
        trim(task."wbsCode"),
        COALESCE(task."wbsSortKey", trim(task."wbsCode")),
        task."createdByUserId"
      FROM "tasks" task
      WHERE task."wbsCode" IS NOT NULL
        AND trim(task."wbsCode") <> ''
      ON CONFLICT ("project_id", "wbs_code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_wbs_codes" CASCADE`);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tasks_supersedes_task"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tasks_superseded_by_task"
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
        DROP CONSTRAINT IF EXISTS "FK_tasks_supersedes_task",
        DROP CONSTRAINT IF EXISTS "FK_tasks_superseded_by_task"
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
        DROP COLUMN IF EXISTS "superseded_at",
        DROP COLUMN IF EXISTS "supersession_reason",
        DROP COLUMN IF EXISTS "supersedes_task_id",
        DROP COLUMN IF EXISTS "superseded_by_task_id"
    `);
  }
}
