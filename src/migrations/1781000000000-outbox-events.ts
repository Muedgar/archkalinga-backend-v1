import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4 — Outbox Events
 *
 * Creates outbox_events table for transactional outbox pattern.
 * Events are written atomically with mutations, then polled and
 * published to the domain-events Bull queue by OutboxPublisherService.
 */
export class OutboxEvents1781000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "outbox_event_status_enum" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED')
    `);

    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "pkid"            SERIAL                         NOT NULL,
        "id"              UUID                           NOT NULL DEFAULT uuid_generate_v4(),
        "version"         INTEGER                        NOT NULL DEFAULT 1,
        "created_at"      TIMESTAMPTZ                    NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ                    NOT NULL DEFAULT now(),

        -- What domain object changed
        "aggregate_type"  VARCHAR(100)                   NOT NULL,
        "aggregate_id"    UUID                           NOT NULL,

        -- Structured event type, e.g. 'task.created', 'project.member.updated'
        "event_type"      VARCHAR(150)                   NOT NULL,

        -- Full event payload (actor, delta, context)
        "payload"         JSONB                          NOT NULL DEFAULT '{}',

        -- Processing state
        "status"          "outbox_event_status_enum"     NOT NULL DEFAULT 'PENDING',
        "retry_count"     SMALLINT                       NOT NULL DEFAULT 0,
        "published_at"    TIMESTAMPTZ                    NULL,
        "error_message"   TEXT                           NULL,

        CONSTRAINT "UQ_outbox_events_id"  UNIQUE ("id"),
        CONSTRAINT "PK_outbox_events"     PRIMARY KEY ("pkid")
      )
    `);

    // Fast pending-events poll
    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_events_status_created"
        ON "outbox_events" ("status", "created_at")
        WHERE "status" = 'PENDING'
    `);

    // Fast aggregate-scoped queries (replay, audit)
    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_events_aggregate"
        ON "outbox_events" ("aggregate_type", "aggregate_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_events" CASCADE`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "outbox_event_status_enum" CASCADE`,
    );
  }
}
