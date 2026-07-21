import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';
import type { ProjectPermissionMatrix } from '../types/project-permission-matrix.type';

export class CreateProjectRoleDto {
  @ApiProperty({
    example: 'Site Supervisor',
    description:
      'Human-readable project role name shown in settings and assignment pickers',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description:
      'Project-scoped permission matrix. ' +
      '\n\n' +
      '`canManageProject` (boolean) — compatibility umbrella for project settings ' +
      'and legacy project-admin checks during rollout. New role, config, member, ' +
      'and invite authorization should use the granular domains below.' +
      '\n\n' +
      'Resource domains (taskManagement, documentManagement, changeRequestManagement, ' +
      'projectRoleManagement, projectConfigManagement, projectMemberManagement) each ' +
      'support create, update, view, delete actions. Missing domains or actions default to false.' +
      '\n\n' +
      '`taskManagement.viewScope` controls task visibility when `taskManagement.view` is true: ' +
      "`all` lets the project member view every task/subtask; `assigned` limits them to tasks " +
      'they created, are assigned to, or report to.',
    example: {
      canManageProject:        false,
      taskManagement:          { create: true,  update: true,  view: true, delete: false, viewScope: 'all' },
      documentManagement:      { create: false, update: false, view: true, delete: false },
      changeRequestManagement: { create: false, update: false, view: true, delete: false },
      projectRoleManagement:   { create: false, update: false, view: false, delete: false },
      projectConfigManagement: { create: false, update: false, view: true,  delete: false },
      projectMemberManagement: { create: false, update: false, view: true,  delete: false },
    },
  })
  @IsObject()
  permissions: Partial<ProjectPermissionMatrix>;
}
