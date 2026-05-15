import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizePublicProfileColumnNames1786300000000
  implements MigrationInterface
{
  name = 'NormalizePublicProfileColumnNames1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const usersTable = await queryRunner.getTable('users');
    const hasCamelUserColumn = usersTable?.findColumnByName('isPublicProfile');
    const hasSnakeUserColumn = usersTable?.findColumnByName('is_public_profile');

    if (hasCamelUserColumn && !hasSnakeUserColumn) {
      await queryRunner.query(`
        ALTER TABLE "users"
          RENAME COLUMN "isPublicProfile" TO "is_public_profile"
      `);
    } else if (!hasSnakeUserColumn) {
      await queryRunner.query(`
        ALTER TABLE "users"
          ADD COLUMN "is_public_profile" boolean NOT NULL DEFAULT false
      `);
    }

    const workspacesTable = await queryRunner.getTable('workspaces');
    const hasCamelWorkspaceColumn =
      workspacesTable?.findColumnByName('allowPublicProfiles');
    const hasSnakeWorkspaceColumn =
      workspacesTable?.findColumnByName('allow_public_profiles');

    if (hasCamelWorkspaceColumn && !hasSnakeWorkspaceColumn) {
      await queryRunner.query(`
        ALTER TABLE "workspaces"
          RENAME COLUMN "allowPublicProfiles" TO "allow_public_profiles"
      `);
    } else if (!hasSnakeWorkspaceColumn) {
      await queryRunner.query(`
        ALTER TABLE "workspaces"
          ADD COLUMN "allow_public_profiles" boolean NOT NULL DEFAULT false
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usersTable = await queryRunner.getTable('users');

    if (
      usersTable?.findColumnByName('is_public_profile') &&
      !usersTable.findColumnByName('isPublicProfile')
    ) {
      await queryRunner.query(`
        ALTER TABLE "users"
          RENAME COLUMN "is_public_profile" TO "isPublicProfile"
      `);
    }

    const workspacesTable = await queryRunner.getTable('workspaces');

    if (
      workspacesTable?.findColumnByName('allow_public_profiles') &&
      !workspacesTable.findColumnByName('allowPublicProfiles')
    ) {
      await queryRunner.query(`
        ALTER TABLE "workspaces"
          RENAME COLUMN "allow_public_profiles" TO "allowPublicProfiles"
      `);
    }
  }
}
