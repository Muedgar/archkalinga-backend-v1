import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskSyncEvents1789300000000 implements MigrationInterface {
  name = 'AddTaskSyncEvents1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_sync_events" (
        "pkid" serial NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "project_id" uuid NOT NULL,
        "task_id" uuid,
        "client_event_id" varchar(120) NOT NULL,
        "type" varchar(80) NOT NULL,
        "status" varchar(30) NOT NULL,
        "actor_user_id" uuid,
        "occurred_at" timestamptz NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "result" jsonb,
        "error_message" text,
        CONSTRAINT "UQ_task_sync_events_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_sync_events" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_sync_events_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_sync_events_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_task_sync_events_actor_user" FOREIGN KEY ("actor_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_sync_events_project_client_unique"
        ON "task_sync_events" ("project_id", "client_event_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_sync_events_task_created"
        ON "task_sync_events" ("task_id", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_sync_events" CASCADE`);
  }
}
