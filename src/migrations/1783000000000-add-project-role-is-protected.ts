import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add missing `isProtected` column to `project_roles`.
 *
 * The `ProjectRole` entity declares `isProtected: boolean` but the original
 * table DDL (migration 1776000000000-workspace-refactor) only included
 * `isSystem`. This caused TypeORM to reference a non-existent column whenever
 * `project_roles` was joined (e.g. in the project-invites list queries).
 */
export class AddProjectRoleIsProtected1783000000000
  implements MigrationInterface
{
  name = 'AddProjectRoleIsProtected1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_roles"
        ADD COLUMN IF NOT EXISTS "isProtected" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_roles"
        DROP COLUMN IF EXISTS "isProtected"
    `);
  }
}
