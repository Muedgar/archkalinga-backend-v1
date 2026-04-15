import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

export class CreateProjectRoleDto {
  @ApiProperty({
    example: 'Site Supervisor',
    description: 'Human-readable project role name shown in settings and assignment pickers',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description:
      'Project-scoped permission matrix. ' +
      '\n\n' +
      '`canManageProject` (boolean) — top-level flag that gates project-admin actions: ' +
      'updating project settings, managing invites, managing project roles, and changing ' +
      'member roles. Owner and Manager system roles carry this as true; Contributor, ' +
      'Reviewer and Viewer default to false.' +
      '\n\n' +
      'Resource domains (taskManagement, documentManagement, changeRequestManagement) each ' +
      'support create, update, view, delete actions. Missing domains or actions default to false.',
    example: {
      canManageProject:        false,
      taskManagement:          { create: true,  update: true,  view: true, delete: false },
      documentManagement:      { create: false, update: false, view: true, delete: false },
      changeRequestManagement: { create: false, update: false, view: true, delete: false },
    },
  })
  @IsObject()
  permissions: Record<string, boolean | Record<string, boolean>>;
}
