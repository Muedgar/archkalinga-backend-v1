import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeNotificationColumnNames1786400000000
  implements MigrationInterface
{
  name = 'NormalizeNotificationColumnNames1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropNotificationUserForeignKeys(queryRunner);

    const table = await queryRunner.getTable('notifications');
    const userIdColumn = table?.findColumnByName('user_id');
    const camelUserIdColumn = table?.findColumnByName('userId');

    if (userIdColumn && userIdColumn.type !== 'uuid' && camelUserIdColumn) {
      await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "user_id"`);
      await queryRunner.query(`
        ALTER TABLE "notifications"
          RENAME COLUMN "userId" TO "user_id"
      `);
    } else if (!userIdColumn && camelUserIdColumn) {
      await queryRunner.query(`
        ALTER TABLE "notifications"
          RENAME COLUMN "userId" TO "user_id"
      `);
    }

    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'createdAt',
      'created_at',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'updatedAt',
      'updated_at',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'isRead',
      'is_read',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'readAt',
      'read_at',
    );

    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "FK_notifications_user_id_users_id"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_user_created"
        ON "notifications" ("user_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
        ON "notifications" ("user_id")
        WHERE "is_read" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_notifications_user_unread"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_notifications_user_created"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        DROP CONSTRAINT IF EXISTS "FK_notifications_user_id_users_id"
    `);

    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'read_at',
      'readAt',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'is_read',
      'isRead',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'updated_at',
      'updatedAt',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'created_at',
      'createdAt',
    );
    await this.renameColumnIfNeeded(
      queryRunner,
      'notifications',
      'user_id',
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

  private async dropNotificationUserForeignKeys(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        fk_name text;
      BEGIN
        FOR fk_name IN
          SELECT con.conname
          FROM pg_constraint con
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = ANY(con.conkey)
          WHERE con.conrelid = 'notifications'::regclass
            AND con.contype = 'f'
            AND att.attname = 'user_id'
        LOOP
          EXECUTE format(
            'ALTER TABLE "notifications" DROP CONSTRAINT %I',
            fk_name
          );
        END LOOP;
      END $$;
    `);
  }
}
