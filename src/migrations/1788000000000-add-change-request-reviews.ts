import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangeRequestReviews1788000000000 implements MigrationInterface {
  name = 'AddChangeRequestReviews1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "change_request_reviews_status_enum" AS ENUM (
          'PENDING',
          'APPROVED',
          'REJECTED',
          'RETURNED_FOR_REVISION'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "change_request_reviews" (
        "pkid"                  SERIAL                               NOT NULL,
        "id"                    uuid                                 NOT NULL DEFAULT uuid_generate_v4(),
        "version"               integer                              NOT NULL DEFAULT 1,
        "createdAt"             TIMESTAMP                            NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMP                            NOT NULL DEFAULT now(),
        "change_request_id"     uuid                                 NOT NULL,
        "reviewer_user_id"      uuid                                 NOT NULL,
        "assigned_by_user_id"   uuid                                 NOT NULL,
        "role"                  varchar(100),
        "status"                "change_request_reviews_status_enum" NOT NULL DEFAULT 'PENDING',
        "notes"                 text,
        "decision_notes"        text,
        "decided_at"            TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "UQ_change_request_reviews_id" UNIQUE ("id"),
        CONSTRAINT "PK_change_request_reviews" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_change_request_reviews_change_request" FOREIGN KEY ("change_request_id")
          REFERENCES "change_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_reviews_reviewer" FOREIGN KEY ("reviewer_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_change_request_reviews_assigned_by" FOREIGN KEY ("assigned_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_reviews_change_request"
        ON "change_request_reviews" ("change_request_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_reviews_reviewer_status"
        ON "change_request_reviews" ("reviewer_user_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_reviews_assigned_by"
        ON "change_request_reviews" ("assigned_by_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_request_reviews_assigned_by"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_request_reviews_reviewer_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_request_reviews_change_request"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "change_request_reviews" CASCADE`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "change_request_reviews_status_enum"`,
    );
  }
}
