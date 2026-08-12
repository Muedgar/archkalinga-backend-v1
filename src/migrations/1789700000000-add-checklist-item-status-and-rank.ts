import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChecklistItemStatusAndRank1789700000000 implements MigrationInterface {
  name = 'AddChecklistItemStatusAndRank1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        ADD COLUMN IF NOT EXISTS "status_id" uuid,
        ADD COLUMN IF NOT EXISTS "rank" varchar(50)
    `);

    await queryRunner.query(`
      WITH status_choices AS (
        SELECT
          ps."projectId",
          COALESCE(
            (
              SELECT done_status."id"
              FROM "project_statuses" done_status
              WHERE done_status."projectId" = ps."projectId"
                AND done_status."isActive" = true
                AND done_status."isDone" = true
              ORDER BY done_status."orderIndex" ASC, done_status."createdAt" ASC
              LIMIT 1
            ),
            (
              SELECT fallback_done."id"
              FROM "project_statuses" fallback_done
              WHERE fallback_done."projectId" = ps."projectId"
                AND fallback_done."isDone" = true
              ORDER BY fallback_done."isActive" DESC, fallback_done."orderIndex" ASC, fallback_done."createdAt" ASC
              LIMIT 1
            )
          ) AS done_status_id,
          COALESCE(
            (
              SELECT default_status."id"
              FROM "project_statuses" default_status
              WHERE default_status."projectId" = ps."projectId"
                AND default_status."isActive" = true
                AND default_status."isDefault" = true
                AND COALESCE(default_status."isDone", false) = false
              ORDER BY default_status."orderIndex" ASC, default_status."createdAt" ASC
              LIMIT 1
            ),
            (
              SELECT open_status."id"
              FROM "project_statuses" open_status
              WHERE open_status."projectId" = ps."projectId"
                AND open_status."isActive" = true
                AND COALESCE(open_status."isDone", false) = false
              ORDER BY open_status."orderIndex" ASC, open_status."createdAt" ASC
              LIMIT 1
            ),
            (
              SELECT any_status."id"
              FROM "project_statuses" any_status
              WHERE any_status."projectId" = ps."projectId"
              ORDER BY any_status."isActive" DESC, any_status."orderIndex" ASC, any_status."createdAt" ASC
              LIMIT 1
            )
          ) AS open_status_id
        FROM "project_statuses" ps
        GROUP BY ps."projectId"
      )
      UPDATE "task_checklist_items" item
      SET "status_id" = CASE
          WHEN item."completed" = true
            THEN COALESCE(status_choices.done_status_id, task."status_id", status_choices.open_status_id)
          ELSE COALESCE(task."status_id", status_choices.open_status_id, status_choices.done_status_id)
        END
      FROM "tasks" task
      JOIN status_choices ON status_choices."projectId" = task."projectId"
      WHERE item."taskId" = task."id"
        AND item."status_id" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "task_checklist_items"
      SET "rank" = COALESCE("rank", LPAD("orderIndex"::text, 10, '0'))
      WHERE "rank" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        ALTER COLUMN "status_id" SET NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_task_checklist_items_status'
        ) THEN
          ALTER TABLE "task_checklist_items"
            ADD CONSTRAINT "FK_task_checklist_items_status"
            FOREIGN KEY ("status_id")
            REFERENCES "project_statuses" ("id")
            ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_checklist_items_task_status_order"
        ON "task_checklist_items" ("taskId", "status_id", "orderIndex")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_checklist_items_status_rank"
        ON "task_checklist_items" ("status_id", "rank")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_checklist_items_status_rank"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_checklist_items_task_status_order"
    `);

    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        DROP CONSTRAINT IF EXISTS "FK_task_checklist_items_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        DROP COLUMN IF EXISTS "rank",
        DROP COLUMN IF EXISTS "status_id"
    `);
  }
}
