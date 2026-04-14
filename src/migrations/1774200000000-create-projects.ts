import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjects1774200000000 implements MigrationInterface {
  name = 'CreateProjects1774200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ──────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."projects_type_enum"
          AS ENUM('ARCHITECTURE','STRUCTURE','MEP','INTERIOR');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."projects_status_enum"
          AS ENUM('ACTIVE','ON_HOLD','COMPLETED','ARCHIVED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."project_memberships_status_enum"
          AS ENUM('ACTIVE','REMOVED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."project_invites_status_enum"
          AS ENUM('PENDING','ACCEPTED','DECLINED','EXPIRED','REVOKED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // ── Tables ─────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "projects" (
        "pkid"            SERIAL NOT NULL,
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"         integer NOT NULL DEFAULT '1',
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "title"           character varying(200) NOT NULL,
        "description"     text,
        "startDate"       date,
        "endDate"         date,
        "type"            "public"."projects_type_enum" NOT NULL,
        "status"          "public"."projects_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "archivedAt"      TIMESTAMP WITH TIME ZONE,
        "organizationId"  uuid NOT NULL,
        "templateId"      uuid NOT NULL,
        "createdByUserId" uuid NOT NULL,
        "organization_id" integer NOT NULL,
        "template_id"     integer NOT NULL,
        "created_by_id"   integer NOT NULL,
        CONSTRAINT "UQ_projects_id"     UNIQUE ("id"),
        CONSTRAINT "PK_projects_pkid"   PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_roles" (
        "pkid"       SERIAL NOT NULL,
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"    integer NOT NULL DEFAULT '1',
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"  TIMESTAMP NOT NULL DEFAULT now(),
        "projectId"  uuid NOT NULL,
        "name"       character varying(100) NOT NULL,
        "slug"       character varying(100) NOT NULL,
        "status"     boolean NOT NULL DEFAULT true,
        "permissions" jsonb NOT NULL,
        "project_id" integer NOT NULL,
        CONSTRAINT "UQ_project_roles_id" UNIQUE ("id"),
        CONSTRAINT "UQ_project_roles_project_slug" UNIQUE ("projectId", "slug"),
        CONSTRAINT "PK_project_roles_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_invites" (
        "pkid"            SERIAL NOT NULL,
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"         integer NOT NULL DEFAULT '1',
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "inviteeEmail"    character varying(100) NOT NULL,
        "token"           character varying(128) NOT NULL,
        "status"          "public"."project_invites_status_enum" NOT NULL DEFAULT 'PENDING',
        "expiresAt"       TIMESTAMP WITH TIME ZONE NOT NULL,
        "acceptedAt"      TIMESTAMP WITH TIME ZONE,
        "projectId"       uuid NOT NULL,
        "projectRoleId"   uuid NOT NULL,
        "inviterUserId"   uuid NOT NULL,
        "inviteeUserId"   uuid,
        "project_id"      integer NOT NULL,
        "project_role_id" integer NOT NULL,
        "inviter_user_id" integer NOT NULL,
        "invitee_user_id" integer,
        CONSTRAINT "UQ_project_invites_id"    UNIQUE ("id"),
        CONSTRAINT "UQ_project_invites_token" UNIQUE ("token"),
        CONSTRAINT "PK_project_invites_pkid"  PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_memberships" (
        "pkid"                SERIAL NOT NULL,
        "id"                  uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer NOT NULL DEFAULT '1',
        "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "status"              "public"."project_memberships_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "joinedAt"            TIMESTAMP WITH TIME ZONE,
        "removedAt"           TIMESTAMP WITH TIME ZONE,
        "projectId"           uuid NOT NULL,
        "userId"              uuid NOT NULL,
        "projectRoleId"       uuid NOT NULL,
        "invitedByUserId"     uuid,
        "inviteId"            uuid,
        "project_id"          integer NOT NULL,
        "user_id"             integer NOT NULL,
        "project_role_id"     integer NOT NULL,
        "invited_by_user_id"  integer,
        "invite_id"           integer,
        CONSTRAINT "UQ_project_memberships_id"   UNIQUE ("id"),
        CONSTRAINT "PK_project_memberships_pkid" PRIMARY KEY ("pkid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_activity_logs" (
        "pkid"       SERIAL NOT NULL,
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version"    integer NOT NULL DEFAULT '1',
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"  TIMESTAMP NOT NULL DEFAULT now(),
        "taskId"     uuid,
        "actionType" character varying(100) NOT NULL,
        "actionMeta" jsonb DEFAULT '{}',
        "projectId"  uuid NOT NULL,
        "userId"     uuid NOT NULL,
        "project_id" integer NOT NULL,
        "user_id"    integer NOT NULL,
        CONSTRAINT "UQ_project_activity_logs_id"   UNIQUE ("id"),
        CONSTRAINT "PK_project_activity_logs_pkid" PRIMARY KEY ("pkid")
      )
    `);

    // ── Foreign Keys ───────────────────────────────────────────────────────────
    const fks = [
      `ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_organization_id"
         FOREIGN KEY ("organization_id") REFERENCES "organizations"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_template_id"
         FOREIGN KEY ("template_id") REFERENCES "templates"("pkid") ON DELETE RESTRICT`,
      `ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_created_by_id"
         FOREIGN KEY ("created_by_id") REFERENCES "users"("pkid") ON DELETE RESTRICT`,
      `ALTER TABLE "project_roles" ADD CONSTRAINT "FK_project_roles_project_id"
         FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "project_invites" ADD CONSTRAINT "FK_project_invites_project_id"
         FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "project_invites" ADD CONSTRAINT "FK_project_invites_project_role_id"
         FOREIGN KEY ("project_role_id") REFERENCES "project_roles"("pkid") ON DELETE RESTRICT`,
      `ALTER TABLE "project_invites" ADD CONSTRAINT "FK_project_invites_inviter_user_id"
         FOREIGN KEY ("inviter_user_id") REFERENCES "users"("pkid") ON DELETE RESTRICT`,
      `ALTER TABLE "project_invites" ADD CONSTRAINT "FK_project_invites_invitee_user_id"
         FOREIGN KEY ("invitee_user_id") REFERENCES "users"("pkid") ON DELETE SET NULL`,
      `ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_project_id"
         FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_user_id"
         FOREIGN KEY ("user_id") REFERENCES "users"("pkid") ON DELETE RESTRICT`,
      `ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_project_role_id"
         FOREIGN KEY ("project_role_id") REFERENCES "project_roles"("pkid") ON DELETE RESTRICT`,
      `ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_invited_by_id"
         FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("pkid") ON DELETE SET NULL`,
      `ALTER TABLE "project_memberships" ADD CONSTRAINT "FK_project_memberships_invite_id"
         FOREIGN KEY ("invite_id") REFERENCES "project_invites"("pkid") ON DELETE SET NULL`,
      `ALTER TABLE "project_activity_logs" ADD CONSTRAINT "FK_project_activity_logs_project_id"
         FOREIGN KEY ("project_id") REFERENCES "projects"("pkid") ON DELETE CASCADE`,
      `ALTER TABLE "project_activity_logs" ADD CONSTRAINT "FK_project_activity_logs_user_id"
         FOREIGN KEY ("user_id") REFERENCES "users"("pkid") ON DELETE RESTRICT`,
    ];

    for (const fk of fks) {
      await queryRunner.query(
        `DO $$ BEGIN ${fk}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "project_activity_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_memberships"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_invites"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "projects"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."project_invites_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."project_memberships_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."projects_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."projects_type_enum"`,
    );
  }
}
