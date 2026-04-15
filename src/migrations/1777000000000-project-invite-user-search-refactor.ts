import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Project Invite & User Search Refactor
 *
 * Changes:
 *
 * 1. users — add `is_public_profile` boolean (default false)
 *    Users opt in to being discoverable by other workspace users when searching
 *    for people to invite to a project.
 *
 * 2. workspaces — add `allow_public_profiles` boolean (default false)
 *    When true, all members of this workspace are discoverable in user search
 *    regardless of their individual is_public_profile setting.
 *
 * 3. project_invites — clean up:
 *    - Drop task/subtask context columns (task_id, subtask_id, target_type,
 *      target_name, auto_assign_on_accept, project_name)
 *    - Drop invitee_email (invites now use invitee_user_id exclusively)
 *    - Make invitee_user_id NOT NULL (user must already exist at invite time)
 *    - Add partial unique index: only one PENDING invite per (project, invitee)
 *
 * Note: db:fresh is used on each iteration — no backfill needed.
 */
export class ProjectInviteUserSearchRefactor1777000000000
  implements MigrationInterface
{
  name = 'ProjectInviteUserSearchRefactor1777000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. users: add is_public_profile ──────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "is_public_profile" boolean NOT NULL DEFAULT false
    `);

    // ── 2. workspaces: add allow_public_profiles ──────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "workspaces"
        ADD COLUMN "allow_public_profiles" boolean NOT NULL DEFAULT false
    `);

    // ── 3. project_invites: drop task-context columns ─────────────────────────
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        DROP COLUMN IF EXISTS "task_id",
        DROP COLUMN IF EXISTS "subtask_id",
        DROP COLUMN IF EXISTS "target_type",
        DROP COLUMN IF EXISTS "target_name",
        DROP COLUMN IF EXISTS "auto_assign_on_accept",
        DROP COLUMN IF EXISTS "project_name"
    `);

    // ── 4. project_invites: drop invitee_email ────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        DROP COLUMN IF EXISTS "invitee_email"
    `);

    // ── 5. project_invites: make invitee_user_id NOT NULL ─────────────────────
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ALTER COLUMN "invitee_user_id" SET NOT NULL
    `);

    // ── 6. project_invites: partial unique index for PENDING invites ──────────
    //    Prevents duplicate pending invites for the same (project, invitee).
    //    Accepted/revoked/expired invites are not constrained so history is kept.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_invite_pending_per_project_user"
        ON "project_invites" ("project_id", "invitee_user_id")
        WHERE "status" = 'PENDING'
    `);

    // ── 7. project_invites: drop InviteTargetType enum if it exists ───────────
    await queryRunner.query(`
      DROP TYPE IF EXISTS "project_invites_target_type_enum" CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove partial unique index
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_invite_pending_per_project_user"
    `);

    // Restore invitee_user_id to nullable
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ALTER COLUMN "invitee_user_id" DROP NOT NULL
    `);

    // Restore invitee_email
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN "invitee_email" varchar(100) NOT NULL DEFAULT ''
    `);

    // Restore task-context columns
    await queryRunner.query(`
      CREATE TYPE "project_invites_target_type_enum"
        AS ENUM ('project', 'task', 'subtask')
    `);
    await queryRunner.query(`
      ALTER TABLE "project_invites"
        ADD COLUMN "task_id"              uuid          DEFAULT NULL,
        ADD COLUMN "subtask_id"           uuid          DEFAULT NULL,
        ADD COLUMN "target_type"          "project_invites_target_type_enum"
                                          NOT NULL DEFAULT 'project',
        ADD COLUMN "target_name"          varchar(200)  DEFAULT NULL,
        ADD COLUMN "auto_assign_on_accept" boolean      NOT NULL DEFAULT false,
        ADD COLUMN "project_name"         varchar(200)  DEFAULT NULL
    `);

    // Remove public profile columns
    await queryRunner.query(`
      ALTER TABLE "workspaces"
        DROP COLUMN IF EXISTS "allow_public_profiles"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "is_public_profile"
    `);
  }
}
