import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskDocumentSourceTraceability1787600000000 implements MigrationInterface {
  name = 'AddTaskDocumentSourceTraceability1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        ADD COLUMN IF NOT EXISTS "source_task_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        ADD COLUMN IF NOT EXISTS "source_document_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "task_document_attachments"
        ADD COLUMN IF NOT EXISTS "source_attachment_id" uuid
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "task_documents"
          ADD CONSTRAINT "FK_task_documents_source_task"
          FOREIGN KEY ("source_task_id")
          REFERENCES "tasks" ("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "task_documents"
          ADD CONSTRAINT "FK_task_documents_source_document"
          FOREIGN KEY ("source_document_id")
          REFERENCES "task_documents" ("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "task_document_attachments"
          ADD CONSTRAINT "FK_task_document_attachments_source_attachment"
          FOREIGN KEY ("source_attachment_id")
          REFERENCES "task_document_attachments" ("id")
          ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_documents_source_task"
        ON "task_documents" ("source_task_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_documents_source_document"
        ON "task_documents" ("source_document_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_document_attachments_source_attachment"
        ON "task_document_attachments" ("source_attachment_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_document_attachments_source_attachment"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_documents_source_document"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_task_documents_source_task"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_document_attachments"
        DROP CONSTRAINT IF EXISTS "FK_task_document_attachments_source_attachment"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        DROP CONSTRAINT IF EXISTS "FK_task_documents_source_document"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        DROP CONSTRAINT IF EXISTS "FK_task_documents_source_task"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_document_attachments"
        DROP COLUMN IF EXISTS "source_attachment_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        DROP COLUMN IF EXISTS "source_document_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_documents"
        DROP COLUMN IF EXISTS "source_task_id"
    `);
  }
}
