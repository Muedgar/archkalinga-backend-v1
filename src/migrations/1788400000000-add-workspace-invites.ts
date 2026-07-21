import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkspaceInvites1788400000000 implements MigrationInterface {
  name = 'AddWorkspaceInvites1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."workspace_invites_status_enum"
        AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED')
    `);

    await queryRunner.query(`
      CREATE TABLE "workspace_invites" (
        "pkid"                SERIAL        NOT NULL,
        "id"                  uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer       NOT NULL DEFAULT '1',
        "createdAt"           TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP     NOT NULL DEFAULT now(),
        "workspaceId"         uuid          NOT NULL,
        "inviterUserId"       uuid          NOT NULL,
        "inviteeUserId"       uuid          NOT NULL,
        "workspaceRoleId"     uuid          NOT NULL,
        "token"               varchar(128)  NOT NULL,
        "status"              "public"."workspace_invites_status_enum" NOT NULL DEFAULT 'PENDING',
        "expiresAt"           TIMESTAMP WITH TIME ZONE NOT NULL,
        "acceptedAt"          TIMESTAMP WITH TIME ZONE,
        "message"             text,
        "workspace_id"        integer       NOT NULL,
        "inviter_user_id"     integer       NOT NULL,
        "invitee_user_id"     integer       NOT NULL,
        "workspace_role_id"   integer       NOT NULL,
        CONSTRAINT "UQ_workspace_invites_id"    UNIQUE ("id"),
        CONSTRAINT "UQ_workspace_invites_token" UNIQUE ("token"),
        CONSTRAINT "PK_workspace_invites"       PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_workspace_invite_pending_workspace_user"
        ON "workspace_invites" ("workspace_id", "invitee_user_id")
        WHERE "status" = 'PENDING'
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_invites"
        ADD CONSTRAINT "FK_workspace_invites_workspace"
        FOREIGN KEY ("workspace_id")
        REFERENCES "workspaces"("pkid")
        ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_invites"
        ADD CONSTRAINT "FK_workspace_invites_inviter"
        FOREIGN KEY ("inviter_user_id")
        REFERENCES "users"("pkid")
        ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_invites"
        ADD CONSTRAINT "FK_workspace_invites_invitee"
        FOREIGN KEY ("invitee_user_id")
        REFERENCES "users"("pkid")
        ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_invites"
        ADD CONSTRAINT "FK_workspace_invites_role"
        FOREIGN KEY ("workspace_role_id")
        REFERENCES "workspace_roles"("pkid")
        ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workspace_invites"
        DROP CONSTRAINT IF EXISTS "FK_workspace_invites_role"
    `);
    await queryRunner.query(`
      ALTER TABLE "workspace_invites"
        DROP CONSTRAINT IF EXISTS "FK_workspace_invites_invitee"
    `);
    await queryRunner.query(`
      ALTER TABLE "workspace_invites"
        DROP CONSTRAINT IF EXISTS "FK_workspace_invites_inviter"
    `);
    await queryRunner.query(`
      ALTER TABLE "workspace_invites"
        DROP CONSTRAINT IF EXISTS "FK_workspace_invites_workspace"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_workspace_invite_pending_workspace_user"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "workspace_invites"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."workspace_invites_status_enum"
    `);
  }
}
