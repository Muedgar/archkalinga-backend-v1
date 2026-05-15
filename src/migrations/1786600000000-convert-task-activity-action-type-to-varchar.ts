import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertTaskActivityActionTypeToVarchar1786600000000
  implements MigrationInterface
{
  name = 'ConvertTaskActivityActionTypeToVarchar1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('task_activity_logs');
    const actionType = table?.findColumnByName('actionType');

    if (actionType?.type !== 'character varying' && actionType?.type !== 'varchar') {
      await queryRunner.query(`
        ALTER TABLE "task_activity_logs"
          ALTER COLUMN "actionType"
          TYPE varchar(100)
          USING "actionType"::text
      `);
    }

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."task_activity_logs_actiontype_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."task_activity_logs_actiontype_enum"
        AS ENUM(
          'TASK_CREATED',
          'TASK_UPDATED',
          'TASK_MOVED',
          'TASK_DELETED',
          'TASK_ASSIGNED',
          'TASK_UNASSIGNED',
          'COMMENT_ADDED',
          'STATUS_CHANGED',
          'CHECKLIST_UPDATED',
          'DEPENDENCY_ADDED',
          'DEPENDENCY_REMOVED'
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "task_activity_logs"
        ALTER COLUMN "actionType"
        TYPE "public"."task_activity_logs_actiontype_enum"
        USING "actionType"::"public"."task_activity_logs_actiontype_enum"
    `);
  }
}
