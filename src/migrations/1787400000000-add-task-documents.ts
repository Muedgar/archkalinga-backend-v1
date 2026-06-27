import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskDocuments1787400000000 implements MigrationInterface {
  name = 'AddTaskDocuments1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "task_documents_type_enum" AS ENUM ('STARTER', 'DELIVERABLE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_documents" (
        "pkid"                SERIAL                     NOT NULL,
        "id"                  uuid                       NOT NULL DEFAULT uuid_generate_v4(),
        "version"             integer                    NOT NULL DEFAULT 1,
        "createdAt"           TIMESTAMP                  NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP                  NOT NULL DEFAULT now(),
        "task_id"             uuid                       NOT NULL,
        "created_by_user_id"  uuid                       NOT NULL,
        "name"                varchar(255)               NOT NULL,
        "description"         text,
        "type"                "task_documents_type_enum" NOT NULL,
        CONSTRAINT "UQ_task_documents_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_documents" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_documents_task" FOREIGN KEY ("task_id")
          REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_task_documents_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_document_attachments" (
        "pkid"          SERIAL       NOT NULL,
        "id"            uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "version"       integer      NOT NULL DEFAULT 1,
        "createdAt"     TIMESTAMP    NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP    NOT NULL DEFAULT now(),
        "document_id"   uuid         NOT NULL,
        "filename"      varchar(500) NOT NULL,
        "bucket_name"   varchar(255) NOT NULL,
        "notes"         text,
        "is_active"     boolean      NOT NULL DEFAULT true,
        CONSTRAINT "UQ_task_document_attachments_id" UNIQUE ("id"),
        CONSTRAINT "PK_task_document_attachments" PRIMARY KEY ("pkid"),
        CONSTRAINT "FK_task_document_attachments_document" FOREIGN KEY ("document_id")
          REFERENCES "task_documents" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_documents_task_type"
        ON "task_documents" ("task_id", "type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_documents_created_by"
        ON "task_documents" ("created_by_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_document_attachments_document"
        ON "task_document_attachments" ("document_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_document_attachments_active"
        ON "task_document_attachments" ("document_id", "is_active")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_task_document_one_active_attachment"
        ON "task_document_attachments" ("document_id")
        WHERE "is_active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "task_document_attachments" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "task_documents" CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS "task_documents_type_enum"`);
  }
}
