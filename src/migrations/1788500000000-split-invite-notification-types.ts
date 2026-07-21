import { MigrationInterface, QueryRunner } from 'typeorm';

export class SplitInviteNotificationTypes1788500000000
  implements MigrationInterface
{
  name = 'SplitInviteNotificationTypes1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum"
        ADD VALUE IF NOT EXISTS 'PROJECT_INVITE_RECEIVED'
    `);
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum"
        ADD VALUE IF NOT EXISTS 'PROJECT_INVITE_ACCEPTED'
    `);
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum"
        ADD VALUE IF NOT EXISTS 'PROJECT_INVITE_DECLINED'
    `);
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum"
        ADD VALUE IF NOT EXISTS 'PROJECT_INVITE_REVOKED'
    `);
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum"
        ADD VALUE IF NOT EXISTS 'WORKSPACE_INVITE_RECEIVED'
    `);
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum"
        ADD VALUE IF NOT EXISTS 'WORKSPACE_INVITE_ACCEPTED'
    `);
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum"
        ADD VALUE IF NOT EXISTS 'WORKSPACE_INVITE_DECLINED'
    `);
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum"
        ADD VALUE IF NOT EXISTS 'WORKSPACE_INVITE_REVOKED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "notifications"
      SET "type" = CASE "type"::text
        WHEN 'PROJECT_INVITE_RECEIVED' THEN 'INVITE_RECEIVED'
        WHEN 'WORKSPACE_INVITE_RECEIVED' THEN 'INVITE_RECEIVED'
        WHEN 'PROJECT_INVITE_ACCEPTED' THEN 'INVITE_ACCEPTED'
        WHEN 'WORKSPACE_INVITE_ACCEPTED' THEN 'INVITE_ACCEPTED'
        WHEN 'PROJECT_INVITE_DECLINED' THEN 'INVITE_DECLINED'
        WHEN 'WORKSPACE_INVITE_DECLINED' THEN 'INVITE_DECLINED'
        WHEN 'PROJECT_INVITE_REVOKED' THEN 'INVITE_REVOKED'
        WHEN 'WORKSPACE_INVITE_REVOKED' THEN 'INVITE_REVOKED'
        ELSE "type"::text
      END::"notifications_type_enum"
    `);

    await queryRunner.query(`
      CREATE TYPE "notifications_type_enum_old" AS ENUM (
        'INVITE_RECEIVED',
        'INVITE_ACCEPTED',
        'INVITE_DECLINED',
        'INVITE_REVOKED',
        'PROJECT_UPDATE',
        'GENERAL'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "type" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "type" TYPE "notifications_type_enum_old"
        USING "type"::text::"notifications_type_enum_old"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "type" SET DEFAULT 'GENERAL'
    `);
    await queryRunner.query(`
      DROP TYPE "notifications_type_enum"
    `);
    await queryRunner.query(`
      ALTER TYPE "notifications_type_enum_old"
        RENAME TO "notifications_type_enum"
    `);
  }
}
