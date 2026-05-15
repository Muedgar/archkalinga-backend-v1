import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeTaskActivityLogColumns1786500000000
  implements MigrationInterface
{
  name = 'NormalizeTaskActivityLogColumns1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.renameColumnIfNeeded(
      queryRunner,
      'task_activity_logs',
      'userId',
      'actorUserId',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'task_activity_logs',
      'metadata',
      'actionMeta',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'task_activity_logs',
      'user_id',
      'actor_user_id',
    );

    const table = await queryRunner.getTable('task_activity_logs');

    if (!table?.findColumnByName('actorName')) {
      await queryRunner.query(`
        ALTER TABLE "task_activity_logs"
          ADD COLUMN "actorName" varchar(200)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('task_activity_logs');

    if (table?.findColumnByName('actorName')) {
      await queryRunner.query(`
        ALTER TABLE "task_activity_logs"
          DROP COLUMN "actorName"
      `);
    }

    await this.renameColumnIfNeeded(
      queryRunner,
      'task_activity_logs',
      'actor_user_id',
      'user_id',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'task_activity_logs',
      'actionMeta',
      'metadata',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'task_activity_logs',
      'actorUserId',
      'userId',
    );
  }

  private async renameColumnIfNeeded(
    queryRunner: QueryRunner,
    tableName: string,
    from: string,
    to: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);

    if (table?.findColumnByName(from) && !table.findColumnByName(to)) {
      await queryRunner.query(`
        ALTER TABLE "${tableName}"
          RENAME COLUMN "${from}" TO "${to}"
      `);
    }
  }
}
