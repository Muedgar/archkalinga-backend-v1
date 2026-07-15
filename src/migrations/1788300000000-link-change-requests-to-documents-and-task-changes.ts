import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkChangeRequestsToDocumentsAndTaskChanges1788300000000 implements MigrationInterface {
  name = 'LinkChangeRequestsToDocumentsAndTaskChanges1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "change_requests"
        ADD COLUMN IF NOT EXISTS "proposed_task_changes" jsonb
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "change_request_documents" (
        "change_request_id" uuid NOT NULL,
        "document_id"       uuid NOT NULL,
        CONSTRAINT "PK_change_request_documents" PRIMARY KEY ("change_request_id", "document_id"),
        CONSTRAINT "FK_change_request_documents_change_request" FOREIGN KEY ("change_request_id")
          REFERENCES "change_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_request_documents_document" FOREIGN KEY ("document_id")
          REFERENCES "task_documents" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_change_request_documents_document"
        ON "change_request_documents" ("document_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_change_request_documents_document"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "change_request_documents" CASCADE`,
    );
    await queryRunner.query(`
      ALTER TABLE "change_requests"
        DROP COLUMN IF EXISTS "proposed_task_changes"
    `);
  }
}
