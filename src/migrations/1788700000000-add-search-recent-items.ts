import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSearchRecentItems1788700000000 implements MigrationInterface {
  name = 'AddSearchRecentItems1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "search_recent_items" (
        "pkid" SERIAL NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "workspaceId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "type" varchar(40) NOT NULL,
        "resourceId" uuid NOT NULL,
        "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_search_recent_items_pkid" PRIMARY KEY ("pkid"),
        CONSTRAINT "UQ_search_recent_items_id" UNIQUE ("id"),
        CONSTRAINT "UQ_search_recent_items_scope" UNIQUE ("workspaceId", "userId", "type", "resourceId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_search_recent_items_user_opened"
      ON "search_recent_items" ("workspaceId", "userId", "openedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_search_recent_items_user_opened"');
    await queryRunner.query('DROP TABLE IF EXISTS "search_recent_items"');
  }
}
