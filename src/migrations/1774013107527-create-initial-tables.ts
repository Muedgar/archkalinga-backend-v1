import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInitialTables1774013107527 implements MigrationInterface {
  name = 'CreateInitialTables1774013107527';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "organizations" ("pkid" SERIAL NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "version" integer NOT NULL DEFAULT '1', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(200) NOT NULL, "address" character varying(500), "city" character varying(200), "country" character varying(200), "website" character varying(500), CONSTRAINT "UQ_6b031fcd0863e3f6b44230163f9" UNIQUE ("id"), CONSTRAINT "PK_b18af184647c8912b6a58e54e53" PRIMARY KEY ("pkid"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_usertype_enum" AS ENUM('INDIVIDUAL', 'ORGANIZATION')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("pkid" SERIAL NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "version" integer NOT NULL DEFAULT '1', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userName" character varying(200), "firstName" character varying(200) NOT NULL, "lastName" character varying(200) NOT NULL, "email" character varying(100) NOT NULL, "password" character varying(250) NOT NULL, "title" character varying(200), "userType" "public"."users_usertype_enum" NOT NULL DEFAULT 'INDIVIDUAL', "status" boolean NOT NULL DEFAULT true, "isDefaultPassword" boolean NOT NULL DEFAULT true, "twoFactorAuthentication" boolean NOT NULL DEFAULT false, "emailVerified" boolean NOT NULL DEFAULT false, "emailVerificationKey" character varying(250), "emailVerificationExpiry" TIMESTAMP WITH TIME ZONE, "tokenVersion" integer NOT NULL DEFAULT '0', "failedLoginAttempts" integer NOT NULL DEFAULT '0', "lockedUntil" TIMESTAMP WITH TIME ZONE, "passwordResetTokenHash" character varying(64), "passwordResetTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "passwordResetTokenUsedAt" TIMESTAMP WITH TIME ZONE, "organizationId" uuid NOT NULL, "roleId" uuid, "createdById" uuid, "organization_id" integer NOT NULL, "role_id" integer, "created_by_id" integer, CONSTRAINT "UQ_a3ffb1c0c8416b9fc6f907b7433" UNIQUE ("id"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_19ad66d3f7250b74880458f4eb9" PRIMARY KEY ("pkid"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_profiles" ("pkid" SERIAL NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "version" integer NOT NULL DEFAULT '1', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "profession" character varying(200), "specialty" character varying(200), "bio" text, "organizationName" character varying(200), "organizationWebsite" character varying(500), "teamSize" integer, "user_id" integer NOT NULL, CONSTRAINT "UQ_1ec6662219f4605723f1e41b6cb" UNIQUE ("id"), CONSTRAINT "REL_6ca9503d77ae39b4b5a6cc3ba8" UNIQUE ("user_id"), CONSTRAINT "PK_e33fda59eb7fa156a371bfd903b" PRIMARY KEY ("pkid"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("pkid" SERIAL NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "action" character varying(100) NOT NULL, "resource" character varying(100) NOT NULL, "resourceId" character varying, "payload" jsonb, "result" jsonb, "ipAddress" character varying(45), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "actor_id" integer, "organization_id" integer, CONSTRAINT "UQ_1bb179d048bbc581caa3b013439" UNIQUE ("id"), CONSTRAINT "PK_3d0725ebf9c3d41516fba8b48bd" PRIMARY KEY ("pkid"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "roles" ("pkid" SERIAL NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "version" integer NOT NULL DEFAULT '1', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "status" boolean NOT NULL DEFAULT true, "permissions" jsonb NOT NULL, "organizationId" uuid NOT NULL, "organization_id" integer NOT NULL, CONSTRAINT "UQ_c1433d71a4838793a49dcad46ab" UNIQUE ("id"), CONSTRAINT "PK_618a115d0bd8d25941e84c51904" PRIMARY KEY ("pkid"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_sessions" ("pkid" SERIAL NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "version" integer NOT NULL DEFAULT '1', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "refreshTokenHash" character varying(64) NOT NULL, "ipAddress" character varying(45), "deviceLabel" character varying(250), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastUsedAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "user_id" integer NOT NULL, CONSTRAINT "UQ_e93e031a5fed190d4789b6bfd83" UNIQUE ("id"), CONSTRAINT "UQ_ed9d6042a764c80befeeacc595e" UNIQUE ("refreshTokenHash"), CONSTRAINT "PK_8714b3e019bc6f1661bdac365e9" PRIMARY KEY ("pkid"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_21a659804ed7bf61eb91688dea7" FOREIGN KEY ("organization_id") REFERENCES "organizations"("pkid") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1" FOREIGN KEY ("role_id") REFERENCES "roles"("pkid") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_1bbd34899b8e74ef2a7f3212806" FOREIGN KEY ("created_by_id") REFERENCES "users"("pkid") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_profiles" ADD CONSTRAINT "FK_6ca9503d77ae39b4b5a6cc3ba88" FOREIGN KEY ("user_id") REFERENCES "users"("pkid") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_177183f29f438c488b5e8510cdb" FOREIGN KEY ("actor_id") REFERENCES "users"("pkid") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_145f35b204c731ba7fc1a0be0e7" FOREIGN KEY ("organization_id") REFERENCES "organizations"("pkid") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "roles" ADD CONSTRAINT "FK_c328a1ecd12a5f153a96df4509e" FOREIGN KEY ("organization_id") REFERENCES "organizations"("pkid") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_sessions" ADD CONSTRAINT "FK_e9658e959c490b0a634dfc54783" FOREIGN KEY ("user_id") REFERENCES "users"("pkid") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_sessions" DROP CONSTRAINT "FK_e9658e959c490b0a634dfc54783"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roles" DROP CONSTRAINT "FK_c328a1ecd12a5f153a96df4509e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_145f35b204c731ba7fc1a0be0e7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_177183f29f438c488b5e8510cdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_profiles" DROP CONSTRAINT "FK_6ca9503d77ae39b4b5a6cc3ba88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_1bbd34899b8e74ef2a7f3212806"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_21a659804ed7bf61eb91688dea7"`,
    );
    await queryRunner.query(`DROP TABLE "user_sessions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "user_profiles"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_usertype_enum"`);
    await queryRunner.query(`DROP TABLE "organizations"`);
  }
}
