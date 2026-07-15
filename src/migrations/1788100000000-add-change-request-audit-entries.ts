import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangeRequestAuditEntries1788100000000 implements MigrationInterface {
  name = 'AddChangeRequestAuditEntries1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "change_request_audit_action_enum" AS ENUM (
          'CREATED',
          'REVIEW_ASSIGNED',
          'REVIEW_DECIDED',
          'ESCALATED',
          'DECISION_RECORDED',
          'REVISION_SUBMITTED',
          'REOPENED'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "change_request_audit_entries" (
        "pkid"                SERIAL                             NOT NULL,
        "id"                  uuid                               NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer                            NOT NULL DEFAULT 1,
        "createdAt"           TIMESTAMP                          NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP                          NOT NULL DEFAULT now(),
        "change_request_id"   uuid                               NOT NULL,
        "actor_user_id"       uuid                               NOT NULL,
        "action"              "change_request_audit_action_enum" NOT NULL,
        "from_status"         "change_requests_status_enum",
        "to_status"           "change_requests_status_enum",
        "review_id"           uuid,
        "message_id"          uuid,
        "metadata"            jsonb,
        CONSTRAINT "UQ_change_request_audit_entries_id" UNIQUE ("id"),
        CONSTRAINT "PK_change_request_audit_entries" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_change_request_audit_entries_change_request" FOREIGN KEY ("change_request_id")
          REFERENCES "change_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_audit_entries_actor" FOREIGN KEY ("actor_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_change_request_audit_entries_review" FOREIGN KEY ("review_id")
          REFERENCES "change_request_reviews" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_change_request_audit_entries_message" FOREIGN KEY ("message_id")
          REFERENCES "change_request_thread_messages" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_audit_entries_change_request"
        ON "change_request_audit_entries" ("change_request_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_audit_entries_actor"
        ON "change_request_audit_entries" ("actor_user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_audit_entries_action"
        ON "change_request_audit_entries" ("action")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_request_audit_entries_action"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_request_audit_entries_actor"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_request_audit_entries_change_request"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "change_request_audit_entries" CASCADE`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "change_request_audit_action_enum"`,
    );
  }
}
