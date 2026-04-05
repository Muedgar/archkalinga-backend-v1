import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTemplates1774102200000 implements MigrationInterface {
  name = 'CreateTemplates1774102200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "templates" (
        "pkid" SERIAL NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL DEFAULT '1',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "name" character varying(80) NOT NULL,
        "description" character varying(800) NOT NULL,
        "isDefault" boolean NOT NULL DEFAULT false,
        "organizationId" uuid NOT NULL,
        "organization_id" integer NOT NULL,
        CONSTRAINT "UQ_templates_id" UNIQUE ("id"),
        CONSTRAINT "UQ_templates_org_name" UNIQUE ("organizationId", "name"),
        CONSTRAINT "PK_templates_pkid" PRIMARY KEY ("pkid")
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "template_tasks" (
        "pkid" SERIAL NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL DEFAULT '1',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "name" character varying(120) NOT NULL,
        "description" character varying(500) NOT NULL,
        "order" integer NOT NULL,
        "templateId" uuid NOT NULL,
        "parentTaskId" uuid,
        "template_id" integer NOT NULL,
        "parent_task_id" integer,
        CONSTRAINT "UQ_template_tasks_id" UNIQUE ("id"),
        CONSTRAINT "UQ_template_tasks_sibling_order" UNIQUE ("templateId", "parentTaskId", "order"),
        CONSTRAINT "PK_template_tasks_pkid" PRIMARY KEY ("pkid")
      )`,
    );
    // Add FK constraints only if they don't already exist
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "templates"
          ADD CONSTRAINT "FK_templates_organization_id"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("pkid")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "template_tasks"
          ADD CONSTRAINT "FK_template_tasks_template_id"
          FOREIGN KEY ("template_id") REFERENCES "templates"("pkid")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "template_tasks"
          ADD CONSTRAINT "FK_template_tasks_parent_task_id"
          FOREIGN KEY ("parent_task_id") REFERENCES "template_tasks"("pkid")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_template_tasks_template_id"
        ON "template_tasks" ("templateId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_template_tasks_parent_task_id"
        ON "template_tasks" ("parentTaskId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_template_tasks_parent_task_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_template_tasks_template_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "template_tasks" DROP CONSTRAINT IF EXISTS "FK_template_tasks_parent_task_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "template_tasks" DROP CONSTRAINT IF EXISTS "FK_template_tasks_template_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "templates" DROP CONSTRAINT IF EXISTS "FK_templates_organization_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "template_tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "templates"`);
  }
}
