import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivitySchedulePersistence1787100000000 implements MigrationInterface {
  name = 'AddActivitySchedulePersistence1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE "public"."task_schedule_calculation_status_enum"
          AS ENUM ('running', 'success', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_calendars" (
        "pkid"                  SERIAL        NOT NULL,
        "id"                    uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"               integer       NOT NULL DEFAULT 1,
        "createdAt"             TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMP     NOT NULL DEFAULT now(),
        "project_id"            uuid          NOT NULL,
        "timezone"              varchar(100)  NOT NULL DEFAULT 'Africa/Kigali',
        "working_weekdays"      jsonb         NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
        "default_hours_per_day" numeric(5,2)  NOT NULL DEFAULT 8,
        "created_by_user_id"    uuid,
        CONSTRAINT "UQ_project_calendars_id" UNIQUE ("id"),
        CONSTRAINT "UQ_project_calendars_project" UNIQUE ("project_id"),
        CONSTRAINT "PK_project_calendars" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_project_calendars_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_project_calendars_created_by_user" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_calendar_exceptions" (
        "pkid"            SERIAL        NOT NULL,
        "id"              uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"         integer       NOT NULL DEFAULT 1,
        "createdAt"       TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP     NOT NULL DEFAULT now(),
        "calendar_id"     uuid          NOT NULL,
        "date"            date          NOT NULL,
        "is_working_day"  boolean       NOT NULL,
        "name"            varchar(200)  NOT NULL,
        "reason"          text,
        CONSTRAINT "UQ_project_calendar_exceptions_id" UNIQUE ("id"),
        CONSTRAINT "UQ_project_calendar_exceptions_calendar_date" UNIQUE ("calendar_id", "date"),
        CONSTRAINT "PK_project_calendar_exceptions" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_project_calendar_exceptions_calendar" FOREIGN KEY ("calendar_id")
          REFERENCES "project_calendars" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_activity_schedules" (
        "pkid"                 SERIAL          NOT NULL,
        "id"                   uuid            NOT NULL DEFAULT uuid_generate_v4(),
        "version"              integer         NOT NULL DEFAULT 1,
        "createdAt"            TIMESTAMP       NOT NULL DEFAULT now(),
        "updatedAt"            TIMESTAMP       NOT NULL DEFAULT now(),
        "task_id"              uuid            NOT NULL,
        "duration_days"        numeric(10,2),
        "planned_start_date"   date,
        "planned_end_date"     date,
        "planned_start_offset" numeric(10,2),
        "planned_end_offset"   numeric(10,2),
        "actual_start_date"    date,
        "actual_end_date"      date,
        "early_start_offset"   numeric(10,2),
        "early_finish_offset"  numeric(10,2),
        "late_start_offset"    numeric(10,2),
        "late_finish_offset"   numeric(10,2),
        "early_start_date"     date,
        "early_finish_date"    date,
        "late_start_date"      date,
        "late_finish_date"     date,
        "total_float_days"     numeric(10,2),
        "free_float_days"      numeric(10,2),
        "is_critical"          boolean         NOT NULL DEFAULT false,
        "is_manually_scheduled" boolean        NOT NULL DEFAULT false,
        "manual_reason"        text,
        "calculated_at"        TIMESTAMPTZ,
        CONSTRAINT "UQ_task_activity_schedules_id" UNIQUE ("id"),
        CONSTRAINT "UQ_task_activity_schedules_task" UNIQUE ("task_id"),
        CONSTRAINT "PK_task_activity_schedules" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_activity_schedules_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_schedule_overrides" (
        "pkid"               SERIAL        NOT NULL,
        "id"                 uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"            integer       NOT NULL DEFAULT 1,
        "createdAt"          TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"          TIMESTAMP     NOT NULL DEFAULT now(),
        "task_id"            uuid          NOT NULL,
        "field_name"         varchar(100)  NOT NULL,
        "old_value"          jsonb,
        "new_value"          jsonb,
        "reason"             text          NOT NULL,
        "created_by_user_id" uuid,
        CONSTRAINT "UQ_task_schedule_overrides_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_schedule_overrides" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_schedule_overrides_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_schedule_overrides_created_by_user" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_schedule_calculation_runs" (
        "pkid"            SERIAL        NOT NULL,
        "id"              uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"         integer       NOT NULL DEFAULT 1,
        "createdAt"       TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP     NOT NULL DEFAULT now(),
        "project_id"      uuid          NOT NULL,
        "trigger_task_id" uuid,
        "trigger_type"    varchar(100)  NOT NULL,
        "status"          "public"."task_schedule_calculation_status_enum" NOT NULL DEFAULT 'running',
        "started_at"      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "finished_at"     TIMESTAMPTZ,
        "summary_json"    jsonb         NOT NULL DEFAULT '{}'::jsonb,
        "error_message"   text,
        CONSTRAINT "UQ_task_schedule_calculation_runs_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_schedule_calculation_runs" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_schedule_calculation_runs_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_schedule_calculation_runs_trigger_task" FOREIGN KEY ("trigger_task_id")
          REFERENCES "tasks" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_schedule_explanations" (
        "pkid"                    SERIAL        NOT NULL,
        "id"                      uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"                 integer       NOT NULL DEFAULT 1,
        "createdAt"               TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"               TIMESTAMP     NOT NULL DEFAULT now(),
        "calculation_run_id"      uuid          NOT NULL,
        "task_id"                 uuid          NOT NULL,
        "is_critical"             boolean       NOT NULL DEFAULT false,
        "driving_predecessor_ids" jsonb         NOT NULL DEFAULT '[]'::jsonb,
        "successor_pressure_ids"  jsonb         NOT NULL DEFAULT '[]'::jsonb,
        "explanation_json"        jsonb         NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "UQ_task_schedule_explanations_id" UNIQUE ("id"),
        CONSTRAINT "UQ_task_schedule_explanations_run_task" UNIQUE ("calculation_run_id", "task_id"),
        CONSTRAINT "PK_task_schedule_explanations" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_schedule_explanations_run" FOREIGN KEY ("calculation_run_id")
          REFERENCES "task_schedule_calculation_runs" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_schedule_explanations_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_calendar_exceptions_calendar_date"
        ON "project_calendar_exceptions" ("calendar_id", "date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_activity_schedules_critical"
        ON "task_activity_schedules" ("is_critical")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_activity_schedules_dates"
        ON "task_activity_schedules" ("planned_start_date", "planned_end_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_schedule_overrides_task_created"
        ON "task_schedule_overrides" ("task_id", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_schedule_calculation_runs_project_started"
        ON "task_schedule_calculation_runs" ("project_id", "started_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_schedule_explanations_task"
        ON "task_schedule_explanations" ("task_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "task_schedule_explanations" CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "task_schedule_calculation_runs" CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "task_schedule_overrides" CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "task_activity_schedules" CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "project_calendar_exceptions" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "project_calendars" CASCADE`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."task_schedule_calculation_status_enum"`,
    );
  }
}
