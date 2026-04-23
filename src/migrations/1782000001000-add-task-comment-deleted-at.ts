import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskCommentDeletedAt1782000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_comments"
        ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_comments"
        DROP COLUMN IF EXISTS "deletedAt"
    `);
  }
}
