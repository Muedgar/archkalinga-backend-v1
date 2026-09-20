import { MigrationInterface, QueryRunner } from 'typeorm';
/** Runs before the historical enum replacement on fresh installations; harmless on upgraded databases. */
export class DecoupleAuditStatusEnum1787790000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE change_request_audit_entries
      ALTER COLUMN from_status TYPE varchar(40) USING from_status::text,
      ALTER COLUMN to_status TYPE varchar(40) USING to_status::text`);
  }
  async down(): Promise<void> {
    // Audit values must remain independent of mutable workflow enum definitions.
  }
}
