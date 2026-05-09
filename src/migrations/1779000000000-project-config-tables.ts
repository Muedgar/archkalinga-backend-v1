import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Project Config Tables Migration
 *
 * Phase 1: Creates per-project configuration tables that replace hardcoded enums:
 *   - project_statuses   (replaces workflow_columns + tasks_status_enum)
 *   - project_priorities (replaces tasks_priority_enum)
 *   - project_severities (new)
 *   - project_task_types (new)
 *   - project_labels     (new)
 *
 * Phase 2: Migrates tasks table:
 *   - Drops old enum columns: status, priority
 *   - Drops workflowColumnId / workflow_column_id
 *   - Adds FK columns: status_id → project_statuses, priority_id → project_priorities
 *   - Adds FK columns: task_type_id → project_task_types, severity_id → project_severities
 *   - Changes description from TEXT → JSONB
 *   - Adds task_labels join table
 *
 * Seeding: For every existing project, default rows are inserted into all 5
 * config tables. Tasks are then backfilled with default statusId and taskTypeId.
 *
 * Note: db:fresh is the standard deploy strategy — backward compatibility is not required.
 */
export class ProjectConfigTables1779000000000 implements MigrationInterface {
  name = 'ProjectConfigTables1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Drop old workflow_columns table ───────────────────────────────────────
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_columns" CASCADE`);

    // ── Drop old enum types that are being replaced ───────────────────────────
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."tasks_status_enum" CASCADE`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."tasks_priority_enum" CASCADE`,
    );

    // ── project_statuses ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "project_statuses" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer       NOT NULL DEFAULT '1',
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "name"        varchar(100)  NOT NULL,
        "key"         varchar(50)   NOT NULL,
        "color"       varchar(20)   NOT NULL DEFAULT '#6B7280',
        "orderIndex"  integer       NOT NULL DEFAULT '0',
        "wipLimit"    integer,
        "category"    varchar(20)   NOT NULL DEFAULT 'in_progress',
        "isDefault"   boolean       NOT NULL DEFAULT false,
        "isTerminal"  boolean       NOT NULL DEFAULT false,
        "isActive"    boolean       NOT NULL DEFAULT true,
        "projectId"   uuid          NOT NULL,
        "project_id"  integer       NOT NULL,
        CONSTRAINT "UQ_project_statuses_id"          UNIQUE ("id"),
        CONSTRAINT "UQ_project_statuses_project_key" UNIQUE ("project_id", "key"),
        CONSTRAINT "PK_project_statuses"             PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_project_statuses_project"     FOREIGN KEY ("project_id")
          REFERENCES "projects"("pkid") ON DELETE CASCADE
      )
    `);

    // ── project_priorities ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "project_priorities" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer       NOT NULL DEFAULT '1',
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "name"        varchar(100)  NOT NULL,
        "key"         varchar(50)   NOT NULL,
        "color"       varchar(20)   NOT NULL DEFAULT '#6B7280',
        "orderIndex"  integer       NOT NULL DEFAULT '0',
        "isDefault"   boolean       NOT NULL DEFAULT false,
        "isActive"    boolean       NOT NULL DEFAULT true,
        "projectId"   uuid          NOT NULL,
        "project_id"  integer       NOT NULL,
        CONSTRAINT "UQ_project_priorities_id"          UNIQUE ("id"),
        CONSTRAINT "UQ_project_priorities_project_key" UNIQUE ("project_id", "key"),
        CONSTRAINT "PK_project_priorities"             PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_project_priorities_project"     FOREIGN KEY ("project_id")
          REFERENCES "projects"("pkid") ON DELETE CASCADE
      )
    `);

    // ── project_severities ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "project_severities" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer       NOT NULL DEFAULT '1',
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "name"        varchar(100)  NOT NULL,
        "key"         varchar(50)   NOT NULL,
        "color"       varchar(20)   NOT NULL DEFAULT '#6B7280',
        "orderIndex"  integer       NOT NULL DEFAULT '0',
        "isDefault"   boolean       NOT NULL DEFAULT false,
        "isActive"    boolean       NOT NULL DEFAULT true,
        "projectId"   uuid          NOT NULL,
        "project_id"  integer       NOT NULL,
        CONSTRAINT "UQ_project_severities_id"          UNIQUE ("id"),
        CONSTRAINT "UQ_project_severities_project_key" UNIQUE ("project_id", "key"),
        CONSTRAINT "PK_project_severities"             PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_project_severities_project"     FOREIGN KEY ("project_id")
          REFERENCES "projects"("pkid") ON DELETE CASCADE
      )
    `);

    // ── project_task_types ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "project_task_types" (
        "pkid"          SERIAL        NOT NULL,
        "id"            uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"       integer       NOT NULL DEFAULT '1',
        "createdAt"     TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP     NOT NULL DEFAULT now(),
        "name"          varchar(100)  NOT NULL,
        "key"           varchar(50)   NOT NULL,
        "icon"          varchar(50),
        "color"         varchar(20)   NOT NULL DEFAULT '#6B7280',
        "isDefault"     boolean       NOT NULL DEFAULT false,
        "isSubtaskType" boolean       NOT NULL DEFAULT false,
        "isActive"      boolean       NOT NULL DEFAULT true,
        "projectId"     uuid          NOT NULL,
        "project_id"    integer       NOT NULL,
        CONSTRAINT "UQ_project_task_types_id"          UNIQUE ("id"),
        CONSTRAINT "UQ_project_task_types_project_key" UNIQUE ("project_id", "key"),
        CONSTRAINT "PK_project_task_types"             PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_project_task_types_project"     FOREIGN KEY ("project_id")
          REFERENCES "projects"("pkid") ON DELETE CASCADE
      )
    `);

    // ── project_labels ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "project_labels" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer       NOT NULL DEFAULT '1',
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "name"        varchar(100)  NOT NULL,
        "key"         varchar(50)   NOT NULL,
        "color"       varchar(20)   NOT NULL DEFAULT '#6B7280',
        "isActive"    boolean       NOT NULL DEFAULT true,
        "projectId"   uuid          NOT NULL,
        "project_id"  integer       NOT NULL,
        CONSTRAINT "UQ_project_labels_id"          UNIQUE ("id"),
        CONSTRAINT "UQ_project_labels_project_key" UNIQUE ("project_id", "key"),
        CONSTRAINT "PK_project_labels"             PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_project_labels_project"     FOREIGN KEY ("project_id")
          REFERENCES "projects"("pkid") ON DELETE CASCADE
      )
    `);

    // ── Seed defaults for every existing project ──────────────────────────────
    // Each project gets the same set of default statuses, priorities,
    // severities, task types. Labels start empty.
    await queryRunner.query(`
      INSERT INTO "project_statuses"
        ("projectId", "project_id", "name", "key", "color", "orderIndex", "category", "isDefault", "isTerminal", "isActive")
      SELECT
        p."id",
        p."pkid",
        s.name,
        s.key,
        s.color,
        s.order_index,
        s.category,
        s.is_default,
        s.is_terminal,
        true
      FROM "projects" p
      CROSS JOIN (VALUES
        ('To Do',      'todo',        '#6B7280', 0, 'todo',        true,  false),
        ('In Progress','in_progress', '#3B82F6', 1, 'in_progress', false, false),
        ('In Review',  'in_review',   '#F59E0B', 2, 'in_progress', false, false),
        ('Done',       'done',        '#10B981', 3, 'done',        false, true),
        ('Blocked',    'blocked',     '#EF4444', 4, 'in_progress', false, false)
      ) AS s(name, key, color, order_index, category, is_default, is_terminal)
    `);

    await queryRunner.query(`
      INSERT INTO "project_priorities"
        ("projectId", "project_id", "name", "key", "color", "orderIndex", "isDefault", "isActive")
      SELECT
        p."id",
        p."pkid",
        pr.name,
        pr.key,
        pr.color,
        pr.order_index,
        pr.is_default,
        true
      FROM "projects" p
      CROSS JOIN (VALUES
        ('Low',    'low',    '#6B7280', 0, false),
        ('Medium', 'medium', '#F59E0B', 1, true),
        ('High',   'high',   '#EF4444', 2, false),
        ('Urgent', 'urgent', '#DC2626', 3, false)
      ) AS pr(name, key, color, order_index, is_default)
    `);

    await queryRunner.query(`
      INSERT INTO "project_severities"
        ("projectId", "project_id", "name", "key", "color", "orderIndex", "isDefault", "isActive")
      SELECT
        p."id",
        p."pkid",
        sv.name,
        sv.key,
        sv.color,
        sv.order_index,
        sv.is_default,
        true
      FROM "projects" p
      CROSS JOIN (VALUES
        ('Minor',    'minor',    '#6B7280', 0, true),
        ('Major',    'major',    '#F59E0B', 1, false),
        ('Critical', 'critical', '#DC2626', 2, false)
      ) AS sv(name, key, color, order_index, is_default)
    `);

    await queryRunner.query(`
      INSERT INTO "project_task_types"
        ("projectId", "project_id", "name", "key", "color", "isDefault", "isSubtaskType", "isActive")
      SELECT
        p."id",
        p."pkid",
        tt.name,
        tt.key,
        tt.color,
        tt.is_default,
        tt.is_subtask_type,
        true
      FROM "projects" p
      CROSS JOIN (VALUES
        ('Task',    'task',    '#3B82F6', true,  false),
        ('Bug',     'bug',     '#EF4444', false, false),
        ('Feature', 'feature', '#10B981', false, false),
        ('Story',   'story',   '#8B5CF6', false, false),
        ('Subtask', 'subtask', '#6B7280', false, true)
      ) AS tt(name, key, color, is_default, is_subtask_type)
    `);

    // ── Alter tasks table — Phase 2 ───────────────────────────────────────────

    // Drop old enum columns and workflow FK columns
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "priority"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "workflowColumnId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "workflow_column_id"`,
    );

    // Change description from TEXT → JSONB
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "description"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN "description" jsonb`,
    );

    // Add placeholder FK uuid columns (nullable initially for backfill)
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "task_type_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "severity_id" uuid`,
    );

    // Ensure status_id and priority_id columns exist (they were added in Phase 0)
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "status_id"   uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "priority_id" uuid`,
    );

    // Backfill: assign default status and task type to all existing tasks
    await queryRunner.query(`
      UPDATE "tasks" t
      SET
        "status_id"    = ps."id",
        "task_type_id" = pt."id"
      FROM
        (
          SELECT "id", "projectId"
          FROM "project_statuses"
          WHERE "isDefault" = true
        ) ps,
        (
          SELECT "id", "projectId"
          FROM "project_task_types"
          WHERE "isDefault" = true
        ) pt
      WHERE
        t."projectId" = ps."projectId"
        AND t."projectId" = pt."projectId"
    `);

    // Make status_id and task_type_id NOT NULL now that backfill is done
    await queryRunner.query(
      `ALTER TABLE "tasks" ALTER COLUMN "status_id"    SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ALTER COLUMN "task_type_id" SET NOT NULL`,
    );

    // Add FK constraints
    await queryRunner.query(`
      ALTER TABLE "tasks"
        ADD CONSTRAINT "FK_tasks_status"
        FOREIGN KEY ("status_id") REFERENCES "project_statuses"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
        ADD CONSTRAINT "FK_tasks_priority"
        FOREIGN KEY ("priority_id") REFERENCES "project_priorities"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
        ADD CONSTRAINT "FK_tasks_task_type"
        FOREIGN KEY ("task_type_id") REFERENCES "project_task_types"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
        ADD CONSTRAINT "FK_tasks_severity"
        FOREIGN KEY ("severity_id") REFERENCES "project_severities"("id")
        ON DELETE SET NULL
    `);

    // ── task_labels join table ────────────────────────────────────────────────
    //    Uses uuid FKs (taskId → tasks(id), labelId → project_labels(id)) as
    //    the single source of truth — the older dual-column design that also
    //    carried integer task_id/label_id columns has been removed because
    //    the entity only declares the uuid side, leaving the integer FKs
    //    unpopulated and tripping NOT NULL on insert.
    await queryRunner.query(`
      CREATE TABLE "task_labels" (
        "pkid"        SERIAL    NOT NULL,
        "id"          uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer   NOT NULL DEFAULT 1,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"      uuid      NOT NULL,
        "labelId"     uuid      NOT NULL,
        CONSTRAINT "UQ_task_labels_id"          UNIQUE ("id"),
        CONSTRAINT "UQ_task_labels_task_label"  UNIQUE ("taskId", "labelId"),
        CONSTRAINT "PK_task_labels"             PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_labels_task"        FOREIGN KEY ("taskId")
          REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_labels_label"       FOREIGN KEY ("labelId")
          REFERENCES "project_labels"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse Phase 2 task changes
    await queryRunner.query(`DROP TABLE IF EXISTS "task_labels" CASCADE`);

    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_severity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_task_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_priority"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_status"`,
    );

    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "severity_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "task_type_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "status_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "priority_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "description"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN "description" text`,
    );

    // Restore old enum columns
    await queryRunner.query(`
      CREATE TYPE "public"."tasks_status_enum"
        AS ENUM('TODO','IN_PROGRESS','IN_REVIEW','DONE','BLOCKED','CANCELLED')
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."tasks_priority_enum"
        AS ENUM('LOW','MEDIUM','HIGH','URGENT')
    `);
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN "status" "public"."tasks_status_enum" NOT NULL DEFAULT 'TODO'`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN "priority" "public"."tasks_priority_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN "workflowColumnId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN "workflow_column_id" integer`,
    );

    // Reverse Phase 1 config tables
    await queryRunner.query(`DROP TABLE IF EXISTS "project_labels" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_task_types" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_severities" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_priorities" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_statuses" CASCADE`);

    // Restore workflow_columns
    await queryRunner.query(`
      CREATE TABLE "workflow_columns" (
        "pkid"        SERIAL        NOT NULL,
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"     integer       NOT NULL DEFAULT '1',
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "name"        varchar(100)  NOT NULL,
        "statusKey"   varchar(50),
        "orderIndex"  integer       NOT NULL DEFAULT '0',
        "wipLimit"    integer,
        "locked"      boolean       NOT NULL DEFAULT false,
        "projectId"   uuid          NOT NULL,
        "project_id"  integer       NOT NULL,
        CONSTRAINT "UQ_workflow_columns_id" UNIQUE ("id"),
        CONSTRAINT "PK_workflow_columns"    PRIMARY KEY ("pkid")
      )
    `);
  }
}
