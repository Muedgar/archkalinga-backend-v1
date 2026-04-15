import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create notifications table
 *
 * Stores in-app notifications delivered to individual users.
 * Notification types are an enum so new types require a migration.
 */
export class CreateNotifications1778000000000 implements MigrationInterface {
  name = 'CreateNotifications1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum type ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "notifications_type_enum" AS ENUM (
        'INVITE_RECEIVED',
        'INVITE_ACCEPTED',
        'INVITE_DECLINED',
        'INVITE_REVOKED',
        'PROJECT_UPDATE',
        'GENERAL'
      )
    `);

    // ── Table ─────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "pkid"       SERIAL         NOT NULL,
        "id"         uuid           NOT NULL DEFAULT uuid_generate_v4(),
        "version"    integer        NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ    NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ    NOT NULL DEFAULT now(),

        "user_id"    uuid           NOT NULL,
        "type"       "notifications_type_enum" NOT NULL DEFAULT 'GENERAL',
        "title"      varchar(200)   NOT NULL,
        "body"       text           NOT NULL,
        "is_read"    boolean        NOT NULL DEFAULT false,
        "read_at"    TIMESTAMPTZ    DEFAULT NULL,
        "meta"       jsonb          DEFAULT NULL,

        CONSTRAINT "PK_notifications_pkid" PRIMARY KEY ("pkid"),
        CONSTRAINT "UQ_notifications_id"   UNIQUE ("id"),
        CONSTRAINT "FK_notifications_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users" ("id")
          ON DELETE CASCADE
      )
    `);

    // ── Indexes ───────────────────────────────────────────────────────────────
    /** Fast lookup for a user's notification feed ordered by recency. */
    await queryRunner.query(`
      CREATE INDEX "idx_notifications_user_created"
        ON "notifications" ("user_id", "created_at" DESC)
    `);

    /** Efficiently count / filter unread notifications per user. */
    await queryRunner.query(`
      CREATE INDEX "idx_notifications_user_unread"
        ON "notifications" ("user_id")
        WHERE "is_read" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notifications_type_enum"`);
  }
}
