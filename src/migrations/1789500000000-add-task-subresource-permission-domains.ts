import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskSubresourcePermissionDomains1789500000000
  implements MigrationInterface
{
  name = 'AddTaskSubresourcePermissionDomains1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "project_roles"
      SET "permissions" =
        "permissions"
        || jsonb_build_object(
          'taskChecklistManagement',
          jsonb_build_object(
            'create', COALESCE(("permissions"->'taskManagement'->>'create')::boolean, false),
            'update', COALESCE(("permissions"->'taskManagement'->>'update')::boolean, false),
            'view', COALESCE(("permissions"->'taskManagement'->>'view')::boolean, false),
            'delete', COALESCE(("permissions"->'taskManagement'->>'delete')::boolean, false)
          ),
          'taskScheduleManagement',
          jsonb_build_object(
            'create', COALESCE(("permissions"->'taskManagement'->>'create')::boolean, false),
            'update', COALESCE(("permissions"->'taskManagement'->>'update')::boolean, false),
            'view', COALESCE(("permissions"->'taskManagement'->>'view')::boolean, false),
            'delete', COALESCE(("permissions"->'taskManagement'->>'delete')::boolean, false)
          ),
          'taskTeamAssigneeManagement',
          jsonb_build_object(
            'create', COALESCE(("permissions"->'taskManagement'->>'create')::boolean, false),
            'update', COALESCE(("permissions"->'taskManagement'->>'update')::boolean, false),
            'view', COALESCE(("permissions"->'taskManagement'->>'view')::boolean, false),
            'delete', COALESCE(("permissions"->'taskManagement'->>'delete')::boolean, false)
          ),
          'taskTeamReporteeManagement',
          jsonb_build_object(
            'create', COALESCE(("permissions"->'taskManagement'->>'create')::boolean, false),
            'update', COALESCE(("permissions"->'taskManagement'->>'update')::boolean, false),
            'view', COALESCE(("permissions"->'taskManagement'->>'view')::boolean, false),
            'delete', COALESCE(("permissions"->'taskManagement'->>'delete')::boolean, false)
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "project_roles"
      SET "permissions" =
        "permissions"
        - 'taskChecklistManagement'
        - 'taskScheduleManagement'
        - 'taskTeamAssigneeManagement'
        - 'taskTeamReporteeManagement'
    `);
  }
}
