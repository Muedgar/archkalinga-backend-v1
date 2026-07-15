import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangeRequestReopenAuditActions1788200000000 implements MigrationInterface {
  name = 'AddChangeRequestReopenAuditActions1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "change_request_audit_action_enum"
      ADD VALUE IF NOT EXISTS 'REVISION_SUBMITTED'
    `);
    await queryRunner.query(`
      ALTER TYPE "change_request_audit_action_enum"
      ADD VALUE IF NOT EXISTS 'REOPENED'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL enum values cannot be safely removed without rebuilding the type.
  }
}
