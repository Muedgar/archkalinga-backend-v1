import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskChangeRequests1787700000000 implements MigrationInterface {
  name = 'AddTaskChangeRequests1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "change_requests_status_enum" AS ENUM ('NEW', 'ESCALATED', 'RESOLVED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "change_request_messages_type_enum" AS ENUM ('MESSAGE', 'ESCALATION', 'RESOLUTION', 'SYSTEM');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "change_requests" (
        "pkid"                  SERIAL                        NOT NULL,
        "id"                    uuid                          NOT NULL DEFAULT uuid_generate_v4(),
        "version"               integer                       NOT NULL DEFAULT 1,
        "createdAt"             TIMESTAMP                     NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMP                     NOT NULL DEFAULT now(),
        "project_id"            uuid                          NOT NULL,
        "task_id"               uuid                          NOT NULL,
        "created_by_user_id"    uuid                          NOT NULL,
        "status"                "change_requests_status_enum" NOT NULL DEFAULT 'NEW',
        "title"                 varchar(255)                  NOT NULL,
        "description"           text,
        "escalated_to_user_id"  uuid,
        "escalated_at"          TIMESTAMP WITH TIME ZONE,
        "resolved_by_user_id"   uuid,
        "resolved_at"           TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "UQ_change_requests_id" UNIQUE ("id"),
        CONSTRAINT "PK_change_requests" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_change_requests_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_requests_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_requests_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_change_requests_escalated_to" FOREIGN KEY ("escalated_to_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_change_requests_resolved_by" FOREIGN KEY ("resolved_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "change_request_threads" (
        "pkid"                 SERIAL    NOT NULL,
        "id"                   uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "version"              integer   NOT NULL DEFAULT 1,
        "createdAt"            TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"            TIMESTAMP NOT NULL DEFAULT now(),
        "change_request_id"    uuid      NOT NULL,
        "task_id"              uuid      NOT NULL,
        "project_id"           uuid      NOT NULL,
        "created_by_user_id"   uuid      NOT NULL,
        CONSTRAINT "UQ_change_request_threads_id" UNIQUE ("id"),
        CONSTRAINT "UQ_change_request_threads_change_request" UNIQUE ("change_request_id"),
        CONSTRAINT "PK_change_request_threads" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_change_request_threads_change_request" FOREIGN KEY ("change_request_id")
          REFERENCES "change_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_threads_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_threads_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_threads_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "change_request_thread_messages" (
        "pkid"                SERIAL                              NOT NULL,
        "id"                  uuid                                NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer                             NOT NULL DEFAULT 1,
        "createdAt"           TIMESTAMP                           NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP                           NOT NULL DEFAULT now(),
        "thread_id"           uuid                                NOT NULL,
        "change_request_id"   uuid                                NOT NULL,
        "author_user_id"      uuid                                NOT NULL,
        "type"                "change_request_messages_type_enum" NOT NULL DEFAULT 'MESSAGE',
        "body"                text,
        "metadata"            jsonb,
        CONSTRAINT "UQ_change_request_thread_messages_id" UNIQUE ("id"),
        CONSTRAINT "PK_change_request_thread_messages" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_change_request_messages_thread" FOREIGN KEY ("thread_id")
          REFERENCES "change_request_threads" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_messages_change_request" FOREIGN KEY ("change_request_id")
          REFERENCES "change_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_messages_author" FOREIGN KEY ("author_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "change_request_message_attachments" (
        "pkid"                SERIAL       NOT NULL,
        "id"                  uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer      NOT NULL DEFAULT 1,
        "createdAt"           TIMESTAMP    NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP    NOT NULL DEFAULT now(),
        "message_id"          uuid         NOT NULL,
        "change_request_id"   uuid         NOT NULL,
        "created_by_user_id"  uuid         NOT NULL,
        "bucket_name"         varchar(255) NOT NULL,
        "filename"            varchar(512) NOT NULL,
        "original_name"       varchar(255) NOT NULL,
        "mime_type"           varchar(255),
        "size_bytes"          bigint,
        "notes"               text,
        CONSTRAINT "UQ_change_request_message_attachments_id" UNIQUE ("id"),
        CONSTRAINT "PK_change_request_message_attachments" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_change_request_attachments_message" FOREIGN KEY ("message_id")
          REFERENCES "change_request_thread_messages" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_attachments_change_request" FOREIGN KEY ("change_request_id")
          REFERENCES "change_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_attachments_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_requests_project_status"
        ON "change_requests" ("project_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_requests_task_status"
        ON "change_requests" ("task_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_requests_created_by"
        ON "change_requests" ("created_by_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_requests_escalated_to"
        ON "change_requests" ("escalated_to_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_requests_resolved_by"
        ON "change_requests" ("resolved_by_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_threads_project"
        ON "change_request_threads" ("project_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_threads_task"
        ON "change_request_threads" ("task_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_messages_thread_created"
        ON "change_request_thread_messages" ("thread_id", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_messages_change_request"
        ON "change_request_thread_messages" ("change_request_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_messages_author"
        ON "change_request_thread_messages" ("author_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_attachments_message"
        ON "change_request_message_attachments" ("message_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_attachments_change_request"
        ON "change_request_message_attachments" ("change_request_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_attachments_created_by"
        ON "change_request_message_attachments" ("created_by_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "change_request_message_attachments" CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "change_request_thread_messages" CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "change_request_threads" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "change_requests" CASCADE`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "change_request_messages_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "change_requests_status_enum"`,
    );
  }
}
