import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeRemainingTaskColumnMappings1786900000000
  implements MigrationInterface
{
  name = 'NormalizeRemainingTaskColumnMappings1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'created_at',
      'createdAt',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'updated_at',
      'updatedAt',
    );

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_notifications_user_created"
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_user_created"
        ON "notifications" ("user_id", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_notifications_user_created"
    `);
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'updatedAt',
      'updated_at',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'createdAt',
      'created_at',
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_user_created"
        ON "notifications" ("user_id", "created_at" DESC)
    `);
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
