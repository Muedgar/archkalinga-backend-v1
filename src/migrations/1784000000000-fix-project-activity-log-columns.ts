import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix two column mismatches in `project_activity_logs`:
 *
 * 1. `metadata` (jsonb)  → `actionMeta` (jsonb)
 *    The entity was updated to use `actionMeta` but the original DDL
 *    (migration 1776000000000-workspace-refactor) created the column as
 *    `metadata`. TypeORM therefore fails with
 *    "column project_activity_logs.actionMeta does not exist".
 *
 * 2. `actionType` (enum) → `actionType` (varchar 100)
 *    The entity declares `actionType` as `varchar(100)` but the migration
 *    created it as a Postgres ENUM. The two sets of enum values also
 *    diverged (`'project:created'` vs `'PROJECT_CREATED'`), so the column
 *    is converted to plain varchar to match the entity and allow any string.
 */
export class FixProjectActivityLogColumns1784000000000
  implements MigrationInterface
{
  name = 'FixProjectActivityLogColumns1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Rename metadata → actionMeta
    await queryRunner.query(`
      ALTER TABLE "project_activity_logs"
        RENAME COLUMN "metadata" TO "actionMeta"
    `);

    // 2. Convert actionType from ENUM to varchar(100)
    //    USING casts the existing enum values to text.
    await queryRunner.query(`
      ALTER TABLE "project_activity_logs"
        ALTER COLUMN "actionType"
        TYPE varchar(100)
        USING "actionType"::text
    `);

    // 3. Drop the now-unused enum type (best-effort — ignore if already gone)
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."project_activity_logs_actiontype_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the enum (values match the original DDL)
    await queryRunner.query(`
      CREATE TYPE "public"."project_activity_logs_actiontype_enum"
        AS ENUM(
          'project:created','project:updated','project:archived',
          'member:added','member:removed','member:role_changed',
          'invite:sent','invite:accepted','invite:cancelled','invite:resent',
          'task:created','task:updated','task:deleted','task:moved',
          'task:assigned','task:completed','task:reopened',
          'comment:added','document:uploaded'
        )
    `);

    // Restore actionType to enum (cast; rows with values outside the enum will fail)
    await queryRunner.query(`
      ALTER TABLE "project_activity_logs"
        ALTER COLUMN "actionType"
        TYPE "public"."project_activity_logs_actiontype_enum"
        USING "actionType"::"public"."project_activity_logs_actiontype_enum"
    `);

    // Rename actionMeta back to metadata
    await queryRunner.query(`
      ALTER TABLE "project_activity_logs"
        RENAME COLUMN "actionMeta" TO "metadata"
    `);
  }
}
