import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangeRequestImpactFields1787900000000 implements MigrationInterface {
  name = 'AddChangeRequestImpactFields1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "change_requests_impact_type_enum" AS ENUM (
          'SCOPE',
          'COST',
          'SCHEDULE',
          'QUALITY',
          'SAFETY',
          'DOCUMENTATION',
          'OTHER'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "change_requests_priority_enum" AS ENUM (
          'LOW',
          'MEDIUM',
          'HIGH',
          'CRITICAL'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ADD COLUMN IF NOT EXISTS "impact_type" "change_requests_impact_type_enum",
        ADD COLUMN IF NOT EXISTS "priority" "change_requests_priority_enum",
        ADD COLUMN IF NOT EXISTS "reason_category" varchar(100),
        ADD COLUMN IF NOT EXISTS "cost_impact_amount" numeric(14,2),
        ADD COLUMN IF NOT EXISTS "schedule_impact_days" integer,
        ADD COLUMN IF NOT EXISTS "requested_due_date" date
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_requests_impact_type"
        ON "change_requests" ("impact_type")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_requests_priority"
        ON "change_requests" ("priority")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_requests_priority"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_requests_impact_type"`,
    );

    await queryRunner.query(`
      ALTER TABLE "change_requests"
        DROP COLUMN IF EXISTS "requested_due_date",
        DROP COLUMN IF EXISTS "schedule_impact_days",
        DROP COLUMN IF EXISTS "cost_impact_amount",
        DROP COLUMN IF EXISTS "reason_category",
        DROP COLUMN IF EXISTS "priority",
        DROP COLUMN IF EXISTS "impact_type"
    `);

    await queryRunner.query(
      `DROP TYPE IF EXISTS "change_requests_priority_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "change_requests_impact_type_enum"`,
    );
  }
}
