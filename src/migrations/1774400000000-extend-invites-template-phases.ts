import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: extend project_invites with task-context columns.
 */
export class ExtendInvitesTemplatePhases1774400000000 implements MigrationInterface {
  name = 'ExtendInvitesTemplatePhases1774400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. New enum for invite target type ────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."project_invites_target_type_enum"
          AS ENUM('project','task','subtask');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // ── 2. Extend project_invites table ───────────────────────────────────────

    // taskId — UUID of the task the invite was created from (nullable)
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN IF NOT EXISTS "taskId" uuid DEFAULT NULL
    `);

    // subtaskId — UUID of the subtask (nullable, requires taskId)
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN IF NOT EXISTS "subtaskId" uuid DEFAULT NULL
    `);

    // targetType — discriminator for UI / routing
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN IF NOT EXISTS "targetType"
          "public"."project_invites_target_type_enum" NOT NULL DEFAULT 'project'
    `);

    // targetName — denormalized task/subtask title for display
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN IF NOT EXISTS "targetName" character varying(200) DEFAULT NULL
    `);

    // projectName — denormalized project title
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN IF NOT EXISTS "projectName" character varying(200) DEFAULT NULL
    `);

    // message — optional personalised note from the inviter
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN IF NOT EXISTS "message" text DEFAULT NULL
    `);

    // autoAssignOnAccept — auto-assign invitee to task/subtask on acceptance
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN IF NOT EXISTS "autoAssignOnAccept" boolean NOT NULL DEFAULT false
    `);

    // ── 3. Indexes for fast duplicate detection and task-scoped listing ───────

    // Compound index: find pending invites for a given email+project
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_project_invites_email_project_status"
        ON "project_invites" ("projectId", "inviteeEmail", "status")
    `);

    // Index: list all invites for a given task
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_project_invites_task_id"
        ON "project_invites" ("taskId")
        WHERE "taskId" IS NOT NULL
    `);

    // Index: list all invites for a given subtask
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_project_invites_subtask_id"
        ON "project_invites" ("subtaskId")
        WHERE "subtaskId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes on project_invites
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_project_invites_subtask_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_project_invites_task_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_project_invites_email_project_status"`,
    );

    // Drop new columns from project_invites
    for (const col of [
      'autoAssignOnAccept',
      'message',
      'projectName',
      'targetName',
      'targetType',
      'subtaskId',
      'taskId',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "project_invites" DROP COLUMN IF EXISTS "${col}"`,
      );
    }

    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."project_invites_target_type_enum"`,
    );
  }
}
