import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 — Task sub-tables
 *
 * Creates:
 *   - task_checklists        (checklist groups)
 *   - task_watchers          (M2M task ↔ user watch subscriptions)
 *   - task_relations         (task-to-task links: RELATES_TO, BLOCKS, DUPLICATES, CLONES)
 *
 * Alters:
 *   - task_checklist_items   adds nullable checklist_group_id FK → task_checklists
 *
 * Note: task_labels already exists from migration 1779000000000.
 */
export class TaskSubTables1780000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── task_checklists ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "task_checklists" (
        "pkid"        SERIAL                   NOT NULL,
        "id"          UUID                     NOT NULL DEFAULT uuid_generate_v4(),
        "version"     INTEGER                  NOT NULL DEFAULT 1,
        "created_at"  TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "task_id"     UUID                     NOT NULL,
        "title"       VARCHAR(255)             NOT NULL,
        "order_index" INTEGER                  NOT NULL DEFAULT 0,
        CONSTRAINT "UQ_task_checklists_id"           UNIQUE ("id"),
        CONSTRAINT "PK_task_checklists"              PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_checklists_task"         FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_task_checklists_task_id" ON "task_checklists" ("task_id")`,
    );

    // ── task_checklist_items: add checklist_group_id ──────────────────────────
    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        ADD COLUMN "checklist_group_id" UUID NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        ADD CONSTRAINT "FK_task_checklist_items_group"
          FOREIGN KEY ("checklist_group_id")
            REFERENCES "task_checklists" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_task_checklist_items_group_id"
        ON "task_checklist_items" ("checklist_group_id")
    `);

    // ── task_watchers ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "task_watchers" (
        "pkid"        SERIAL                   NOT NULL,
        "id"          UUID                     NOT NULL DEFAULT uuid_generate_v4(),
        "version"     INTEGER                  NOT NULL DEFAULT 1,
        "created_at"  TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "task_id"     UUID                     NOT NULL,
        "user_id"     UUID                     NOT NULL,
        CONSTRAINT "UQ_task_watchers_id"             UNIQUE ("id"),
        CONSTRAINT "UQ_task_watchers_task_user"      UNIQUE ("task_id", "user_id"),
        CONSTRAINT "PK_task_watchers"                PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_watchers_task"           FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_watchers_user"           FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_task_watchers_task_id" ON "task_watchers" ("task_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_watchers_user_id" ON "task_watchers" ("user_id")`,
    );

    // ── task_relation_type enum ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "task_relation_type_enum" AS ENUM (
        'RELATES_TO',
        'BLOCKS',
        'DUPLICATES',
        'CLONES'
      )
    `);

    // ── task_relations ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "task_relations" (
        "pkid"            SERIAL                           NOT NULL,
        "id"              UUID                             NOT NULL DEFAULT uuid_generate_v4(),
        "version"         INTEGER                          NOT NULL DEFAULT 1,
        "created_at"      TIMESTAMPTZ                      NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ                      NOT NULL DEFAULT now(),
        "task_id"         UUID                             NOT NULL,
        "related_task_id" UUID                             NOT NULL,
        "relation_type"   "task_relation_type_enum"        NOT NULL DEFAULT 'RELATES_TO',
        CONSTRAINT "UQ_task_relations_id"                  UNIQUE ("id"),
        CONSTRAINT "UQ_task_relations_task_related"        UNIQUE ("task_id", "related_task_id"),
        CONSTRAINT "PK_task_relations"                     PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_relations_task"                FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_relations_related_task"        FOREIGN KEY ("related_task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_task_relations_task_id" ON "task_relations" ("task_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_relations_related_task_id" ON "task_relations" ("related_task_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_relations" CASCADE`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "task_relation_type_enum" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "task_watchers" CASCADE`);
    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        DROP CONSTRAINT IF EXISTS "FK_task_checklist_items_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        DROP COLUMN IF EXISTS "checklist_group_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "task_checklists" CASCADE`);
  }
}
