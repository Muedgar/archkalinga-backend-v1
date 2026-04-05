import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString } from 'class-validator';
import { PERMISSION_DOMAINS } from '../types/permission-matrix.type';

export class PermissionActionsDto {
  @ApiProperty({ example: false })
  create: boolean;

  @ApiProperty({ example: false })
  update: boolean;

  @ApiProperty({ example: true })
  view: boolean;

  @ApiProperty({ example: false })
  delete: boolean;
}

/** The permissions field accepts the full matrix shape. */
export class CreateRoleDTO {
  @ApiProperty({ example: 'Workspace Viewer', description: 'Human-readable workspace role name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: `Workspace permission matrix. Provide any subset of the ${PERMISSION_DOMAINS.length} domains.
Missing domains default to all-false. Each domain key maps to { create, update, view, delete }.`,
    example: {
      projectManagement: { create: false, update: false, view: true, delete: false },
      taskManagement:    { create: false, update: false, view: true, delete: false },
    },
  })
  @IsObject()
  permissions: Record<string, Record<string, boolean>>;
}
