import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillTaskDocumentAuditColumns1787500000000 implements MigrationInterface {
  name = 'BackfillTaskDocumentAuditColumns1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        ADD COLUMN IF NOT EXISTS "updated_by_user_id" uuid
    `);

    await queryRunner.query(`
      UPDATE "task_documents"
      SET "updated_by_user_id" = "created_by_user_id"
      WHERE "updated_by_user_id" IS NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "task_documents"
          ADD CONSTRAINT "FK_task_documents_updated_by"
          FOREIGN KEY ("updated_by_user_id")
          REFERENCES "users" ("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_documents_updated_by"
        ON "task_documents" ("updated_by_user_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "task_document_attachments"
        ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid
    `);

    await queryRunner.query(`
      UPDATE "task_document_attachments" attachment
      SET "created_by_user_id" = document."created_by_user_id"
      FROM "task_documents" document
      WHERE attachment."document_id" = document."id"
        AND attachment."created_by_user_id" IS NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "task_document_attachments"
          ADD CONSTRAINT "FK_task_document_attachments_created_by"
          FOREIGN KEY ("created_by_user_id")
          REFERENCES "users" ("id")
          ON DELETE RESTRICT;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_document_attachments_created_by"
        ON "task_document_attachments" ("created_by_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_document_attachments"
        DROP CONSTRAINT IF EXISTS "FK_task_document_attachments_created_by"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_document_attachments_created_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_document_attachments"
        DROP COLUMN IF EXISTS "created_by_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        DROP CONSTRAINT IF EXISTS "FK_task_documents_updated_by"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_documents_updated_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        DROP COLUMN IF EXISTS "updated_by_user_id"
    `);
  }
}
