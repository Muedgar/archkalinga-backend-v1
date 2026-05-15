import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeTaskAssigneeRoleColumns1786800000000
  implements MigrationInterface
{
  name = 'NormalizeTaskAssigneeRoleColumns1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('task_assignees');

    if (!table?.findColumnByName('projectRoleId')) {
      await queryRunner.query(`
        ALTER TABLE "task_assignees"
          ADD COLUMN "projectRoleId" uuid
      `);
    }

    if (table?.findColumnByName('project_role_id')) {
      await queryRunner.query(`
        UPDATE "task_assignees" ta
        SET "projectRoleId" = pr."id"
        FROM "project_roles" pr
        WHERE ta."project_role_id" = pr."pkid"
          AND ta."projectRoleId" IS NULL
      `);
    }

    const currentTable = await queryRunner.getTable('task_assignees');
    const assignmentRole = currentTable?.findColumnByName('assignmentRole');

    if (
      assignmentRole?.type !== 'character varying' &&
      assignmentRole?.type !== 'varchar'
    ) {
      await queryRunner.query(`
        ALTER TABLE "task_assignees"
          ALTER COLUMN "assignmentRole" DROP DEFAULT
      `);
      await queryRunner.query(`
        ALTER TABLE "task_assignees"
          ALTER COLUMN "assignmentRole"
          TYPE varchar(50)
          USING "assignmentRole"::text
      `);
      await queryRunner.query(`
        UPDATE "task_assignees"
        SET "assignmentRole" = 'ASSIGNEE'
        WHERE "assignmentRole" NOT IN ('ASSIGNEE', 'REPORTER')
      `);
      await queryRunner.query(`
        ALTER TABLE "task_assignees"
          ALTER COLUMN "assignmentRole" SET DEFAULT 'ASSIGNEE'
      `);
    }

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."task_assignees_assignmentrole_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."task_assignees_assignmentrole_enum"
        AS ENUM('OWNER', 'CONTRIBUTOR', 'REVIEWER')
    `);
    await queryRunner.query(`
      ALTER TABLE "task_assignees"
        ALTER COLUMN "assignmentRole" DROP DEFAULT
    `);
    await queryRunner.query(`
      UPDATE "task_assignees"
      SET "assignmentRole" = 'CONTRIBUTOR'
      WHERE "assignmentRole"::text NOT IN ('OWNER', 'CONTRIBUTOR', 'REVIEWER')
    `);
    await queryRunner.query(`
      ALTER TABLE "task_assignees"
        ALTER COLUMN "assignmentRole"
        TYPE "public"."task_assignees_assignmentrole_enum"
        USING "assignmentRole"::"public"."task_assignees_assignmentrole_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_assignees"
        ALTER COLUMN "assignmentRole" SET DEFAULT 'CONTRIBUTOR'
    `);

    const table = await queryRunner.getTable('task_assignees');

    if (table?.findColumnByName('projectRoleId')) {
      await queryRunner.query(`
        ALTER TABLE "task_assignees"
          DROP COLUMN "projectRoleId"
      `);
    }
  }
}
