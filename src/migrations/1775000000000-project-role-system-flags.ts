import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectRoleSystemFlags1775000000000 implements MigrationInterface {
  name = 'ProjectRoleSystemFlags1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_roles"
      ADD COLUMN IF NOT EXISTS "isSystem" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "project_roles"
      ADD COLUMN IF NOT EXISTS "isProtected" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      UPDATE "project_roles"
      SET "isSystem" = true
      WHERE "slug" IN ('owner', 'project-admin', 'contributor', 'viewer')
    `);

    await queryRunner.query(`
      UPDATE "project_roles"
      SET "isProtected" = true
      WHERE "slug" = 'owner'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_roles"
      DROP COLUMN IF EXISTS "isProtected"
    `);

    await queryRunner.query(`
      ALTER TABLE "project_roles"
      DROP COLUMN IF EXISTS "isSystem"
    `);
  }
}
