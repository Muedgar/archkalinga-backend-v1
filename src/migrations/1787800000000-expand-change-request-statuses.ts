import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandChangeRequestStatuses1787800000000
  implements MigrationInterface
{
  name = 'ExpandChangeRequestStatuses1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ALTER COLUMN "status" DROP DEFAULT
    `);

    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ALTER COLUMN "status" TYPE text
        USING "status"::text
    `);

    await queryRunner.query(`
      UPDATE "change_requests"
      SET "status" = 'APPROVED'
      WHERE "status" = 'RESOLVED'
    `);

    await queryRunner.query(`DROP TYPE "change_requests_status_enum"`);

    await queryRunner.query(`
      CREATE TYPE "change_requests_status_enum" AS ENUM (
        'NEW',
        'UNDER_REVIEW',
        'ESCALATED',
        'APPROVED',
        'REJECTED',
        'RETURNED_FOR_REVISION',
        'CANCELLED'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ALTER COLUMN "status" TYPE "change_requests_status_enum"
        USING "status"::"change_requests_status_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ALTER COLUMN "status" SET DEFAULT 'NEW'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ALTER COLUMN "status" DROP DEFAULT
    `);

    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ALTER COLUMN "status" TYPE text
        USING "status"::text
    `);

    await queryRunner.query(`
      UPDATE "change_requests"
      SET "status" = CASE
        WHEN "status" IN ('APPROVED', 'REJECTED', 'RETURNED_FOR_REVISION', 'CANCELLED')
          THEN 'RESOLVED'
        WHEN "status" = 'UNDER_REVIEW'
          THEN 'NEW'
        ELSE "status"
      END
    `);

    await queryRunner.query(`DROP TYPE "change_requests_status_enum"`);

    await queryRunner.query(`
      CREATE TYPE "change_requests_status_enum" AS ENUM (
        'NEW',
        'ESCALATED',
        'RESOLVED'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ALTER COLUMN "status" TYPE "change_requests_status_enum"
        USING "status"::"change_requests_status_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ALTER COLUMN "status" SET DEFAULT 'NEW'
    `);
  }
}
