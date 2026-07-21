import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectAdminPermissionDomains1788800000000
  implements MigrationInterface
{
  name = 'AddProjectAdminPermissionDomains1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "project_roles"
      SET "permissions" =
        "permissions"
        || jsonb_build_object(
          'projectRoleManagement',
          CASE
            WHEN "permissions"->>'canManageProject' = 'true' THEN
              jsonb_build_object(
                'create', true,
                'update', true,
                'view', true,
                'delete', true
              )
            ELSE
              jsonb_build_object(
                'create', false,
                'update', false,
                'view', false,
                'delete', false
              )
          END,
          'projectConfigManagement',
          CASE
            WHEN "permissions"->>'canManageProject' = 'true' THEN
              jsonb_build_object(
                'create', true,
                'update', true,
                'view', true,
                'delete', true
              )
            WHEN "permissions"->'taskManagement'->>'view' = 'true' THEN
              jsonb_build_object(
                'create', false,
                'update', false,
                'view', true,
                'delete', false
              )
            ELSE
              jsonb_build_object(
                'create', false,
                'update', false,
                'view', false,
                'delete', false
              )
          END,
          'projectMemberManagement',
          CASE
            WHEN "permissions"->>'canManageProject' = 'true' THEN
              jsonb_build_object(
                'create', true,
                'update', true,
                'view', true,
                'delete', true
              )
            WHEN "slug" IN ('contributor', 'reviewer') THEN
              jsonb_build_object(
                'create', false,
                'update', false,
                'view', true,
                'delete', false
              )
            ELSE
              jsonb_build_object(
                'create', false,
                'update', false,
                'view', false,
                'delete', false
              )
          END
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "project_roles"
      SET "permissions" =
        "permissions"
        - 'projectRoleManagement'
        - 'projectConfigManagement'
        - 'projectMemberManagement'
    `);
  }
}
