import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add composite indexes used by GET /projects/:id.
 *
 * AddPerformanceIndexes1786000000000 may already be applied in existing DBs, so
 * these follow-up indexes need their own migration to be picked up by TypeORM.
 */
export class OptimizeProjectDetailFetch1786100000000 implements MigrationInterface {
  name = 'OptimizeProjectDetailFetch1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_memberships_projectId_status_joinedAt"
        ON "project_memberships" ("projectId", "status", "joinedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_roles_projectId_createdAt"
        ON "project_roles" ("projectId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_invites_projectId_status"
        ON "project_invites" ("projectId", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_activity_logs_projectId_createdAt"
        ON "project_activity_logs" ("projectId", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_project_activity_logs_projectId_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_project_invites_projectId_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_project_roles_projectId_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_project_memberships_projectId_status_joinedAt"`);
  }
}
