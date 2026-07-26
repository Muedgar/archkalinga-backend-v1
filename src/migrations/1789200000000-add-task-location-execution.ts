import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskLocationExecution1789200000000 implements MigrationInterface {
  name = 'AddTaskLocationExecution1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_locations" (
        "pkid" serial NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "task_id" uuid NOT NULL,
        "location_code" varchar(100),
        "location_name" varchar(255) NOT NULL,
        "description" text,
        "planned_quantity" numeric(14,2),
        "unit" varchar(50),
        "order_index" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_task_locations_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_locations" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_locations_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_locations_task_order"
        ON "task_locations" ("task_id", "order_index")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_locations_task_code_unique"
        ON "task_locations" ("task_id", "location_code")
        WHERE "location_code" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_location_progress" (
        "pkid" serial NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "task_location_id" uuid NOT NULL,
        "progress" smallint,
        "completed" boolean NOT NULL DEFAULT false,
        "status" varchar(50),
        "actual_quantity" numeric(14,2),
        "site_note" text,
        "updated_by_user_id" uuid,
        "reported_at" timestamptz,
        CONSTRAINT "UQ_task_location_progress_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_location_progress" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_location_progress_location" FOREIGN KEY ("task_location_id")
          REFERENCES "task_locations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_location_progress_updated_by_user" FOREIGN KEY ("updated_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_location_progress_location_unique"
        ON "task_location_progress" ("task_location_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "task_location_progress" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "task_locations" CASCADE`);
  }
}
