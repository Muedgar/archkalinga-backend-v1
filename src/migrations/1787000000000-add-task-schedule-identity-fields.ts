import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskScheduleIdentityFields1787000000000 implements MigrationInterface {
  name = 'AddTaskScheduleIdentityFields1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."tasks_scheduletype_enum"
          AS ENUM ('phase', 'stage', 'activity', 'task', 'milestone');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
        ADD COLUMN IF NOT EXISTS "scheduleType" "public"."tasks_scheduletype_enum" NOT NULL DEFAULT 'task',
        ADD COLUMN IF NOT EXISTS "wbsCode" varchar(100),
        ADD COLUMN IF NOT EXISTS "wbsSortKey" varchar(500),
        ADD COLUMN IF NOT EXISTS "weightPercent" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "isManuallyScheduled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "manualScheduleReason" text
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_tasks_project_wbs_code_unique"
        ON "tasks" ("projectId", "wbsCode")
        WHERE "wbsCode" IS NOT NULL AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_project_wbs_sort"
        ON "tasks" ("projectId", "wbsSortKey", "deletedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_project_schedule_type"
        ON "tasks" ("projectId", "scheduleType", "deletedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tasks_project_schedule_type"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tasks_project_wbs_sort"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tasks_project_wbs_code_unique"
    `);

    await queryRunner.query(`
      ALTER TABLE "tasks"
        DROP COLUMN IF EXISTS "manualScheduleReason",
        DROP COLUMN IF EXISTS "isManuallyScheduled",
        DROP COLUMN IF EXISTS "weightPercent",
        DROP COLUMN IF EXISTS "wbsSortKey",
        DROP COLUMN IF EXISTS "wbsCode",
        DROP COLUMN IF EXISTS "scheduleType"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."tasks_scheduletype_enum"
    `);
  }
}
