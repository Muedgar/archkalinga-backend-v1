import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectMembershipInviteId1782000000000
  implements MigrationInterface
{
  name = 'AddProjectMembershipInviteId1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_memberships"
        ADD COLUMN IF NOT EXISTS "invite_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_memberships"
        DROP COLUMN IF EXISTS "invite_id"
    `);
  }
}
