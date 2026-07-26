import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChecklistItemBranching1789000000000 implements MigrationInterface {
  name = 'AddChecklistItemBranching1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        ADD COLUMN IF NOT EXISTS "item_code" varchar(100),
        ADD COLUMN IF NOT EXISTS "branched_task_id" uuid,
        ADD COLUMN IF NOT EXISTS "branch_status" varchar(30) NOT NULL DEFAULT 'flat',
        ADD COLUMN IF NOT EXISTS "branched_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "branched_at" timestamptz
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        ALTER TABLE "task_checklist_items"
          ADD CONSTRAINT "FK_task_checklist_items_branched_task"
          FOREIGN KEY ("branched_task_id") REFERENCES "tasks" ("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        ALTER TABLE "task_checklist_items"
          ADD CONSTRAINT "FK_task_checklist_items_branched_by_user"
          FOREIGN KEY ("branched_by_user_id") REFERENCES "users" ("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_checklist_items_branched_task_unique"
        ON "task_checklist_items" ("branched_task_id")
        WHERE "branched_task_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_checklist_items_task_item_code_unique"
        ON "task_checklist_items" ("task_id", "item_code")
        WHERE "item_code" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_checklist_items_branch_status"
        ON "task_checklist_items" ("task_id", "branch_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_checklist_items_branch_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_checklist_items_task_item_code_unique"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_checklist_items_branched_task_unique"
    `);

    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        DROP CONSTRAINT IF EXISTS "FK_task_checklist_items_branched_by_user",
        DROP CONSTRAINT IF EXISTS "FK_task_checklist_items_branched_task"
    `);

    await queryRunner.query(`
      ALTER TABLE "task_checklist_items"
        DROP COLUMN IF EXISTS "branched_at",
        DROP COLUMN IF EXISTS "branched_by_user_id",
        DROP COLUMN IF EXISTS "branch_status",
        DROP COLUMN IF EXISTS "branched_task_id",
        DROP COLUMN IF EXISTS "item_code"
    `);
  }
}
