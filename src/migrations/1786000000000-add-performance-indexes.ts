import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add missing indexes on all heavily-queried foreign key columns.
 *
 * Without these indexes PostgreSQL performs a full sequential scan on every
 * lookup — e.g. "find all projects for workspace X" scans the entire projects
 * table. On real datasets this alone accounts for 1-2 seconds per query.
 *
 * Column name convention in this codebase:
 *   - UUID FK columns use camelCase (TypeORM default):  "projectId", "userId", etc.
 *   - Integer PKID FK columns use snake_case:           "project_id", "user_id", etc.
 *   - Tasks config FKs (added in migration 1779) are also snake_case: "status_id", etc.
 *
 * All indexes use IF NOT EXISTS so the migration is safe to re-run.
 */
export class AddPerformanceIndexes1786000000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── projects ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_projects_workspaceId"
        ON "projects" ("workspaceId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_projects_templateId"
        ON "projects" ("templateId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_projects_createdByUserId"
        ON "projects" ("createdByUserId")
    `);

    // ── project_memberships ───────────────────────────────────────────────────
    // Checked on EVERY project-scoped request by WorkspaceGuard and permission guards.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_memberships_projectId"
        ON "project_memberships" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_memberships_userId"
        ON "project_memberships" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_memberships_projectRoleId"
        ON "project_memberships" ("projectRoleId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_memberships_projectId_status_joinedAt"
        ON "project_memberships" ("projectId", "status", "joinedAt")
    `);

    // ── project_roles ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_roles_projectId"
        ON "project_roles" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_roles_projectId_createdAt"
        ON "project_roles" ("projectId", "createdAt")
    `);

    // ── project_invites ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_invites_projectId"
        ON "project_invites" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_invites_projectId_status"
        ON "project_invites" ("projectId", "status")
    `);

    // ── project_activity_logs ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_activity_logs_projectId"
        ON "project_activity_logs" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_activity_logs_createdAt"
        ON "project_activity_logs" ("createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_activity_logs_projectId_createdAt"
        ON "project_activity_logs" ("projectId", "createdAt" DESC)
    `);

    // ── tasks ─────────────────────────────────────────────────────────────────
    // tasks."projectId" is the most critical — used by every task list/lookup.
    // UUID FK columns added in migration 1776 are camelCase.
    // Config FK columns added in migration 1779 are snake_case (status_id, etc.).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_projectId"
        ON "tasks" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_parentTaskId"
        ON "tasks" ("parentTaskId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_createdByUserId"
        ON "tasks" ("createdByUserId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_status_id"
        ON "tasks" ("status_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_task_type_id"
        ON "tasks" ("task_type_id")
    `);
    // Composite for soft-delete queries: WHERE "projectId" = ? AND "deletedAt" IS NULL
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tasks_projectId_deletedAt"
        ON "tasks" ("projectId", "deletedAt")
    `);

    // ── task_activity_logs ────────────────────────────────────────────────────
    // This table has "taskId" (UUID camelCase) but no UUID "projectId" column.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_task_activity_logs_taskId"
        ON "task_activity_logs" ("taskId")
    `);

    // ── workspace_members ─────────────────────────────────────────────────────
    // Scanned on EVERY authenticated request by WorkspaceGuard.
    // A unique constraint already exists on the integer PK pair; these are
    // plain indexes on the UUID columns TypeORM actually uses in WHERE clauses.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_members_workspaceId"
        ON "workspace_members" ("workspaceId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_members_userId"
        ON "workspace_members" ("userId")
    `);
    // Composite for the exact query WorkspaceGuard fires: WHERE "workspaceId"=? AND "userId"=?
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_members_workspaceId_userId"
        ON "workspace_members" ("workspaceId", "userId")
    `);

    // ── project config tables (project_statuses / types / priorities / severities) ──
    // Queried during every task seeding to find the default status/type.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_statuses_projectId"
        ON "project_statuses" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_task_types_projectId"
        ON "project_task_types" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_priorities_projectId"
        ON "project_priorities" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_severities_projectId"
        ON "project_severities" ("projectId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const indexes = [
      'idx_projects_workspaceId',
      'idx_projects_templateId',
      'idx_projects_createdByUserId',
      'idx_project_memberships_projectId',
      'idx_project_memberships_userId',
      'idx_project_memberships_projectRoleId',
      'idx_project_memberships_projectId_status_joinedAt',
      'idx_project_roles_projectId',
      'idx_project_roles_projectId_createdAt',
      'idx_project_invites_projectId',
      'idx_project_invites_projectId_status',
      'idx_project_activity_logs_projectId',
      'idx_project_activity_logs_createdAt',
      'idx_project_activity_logs_projectId_createdAt',
      'idx_tasks_projectId',
      'idx_tasks_parentTaskId',
      'idx_tasks_createdByUserId',
      'idx_tasks_status_id',
      'idx_tasks_task_type_id',
      'idx_tasks_projectId_deletedAt',
      'idx_task_activity_logs_taskId',
      'idx_workspace_members_workspaceId',
      'idx_workspace_members_userId',
      'idx_workspace_members_workspaceId_userId',
      'idx_project_statuses_projectId',
      'idx_project_task_types_projectId',
      'idx_project_priorities_projectId',
      'idx_project_severities_projectId',
    ];

    for (const name of indexes) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${name}"`);
    }
  }
}
