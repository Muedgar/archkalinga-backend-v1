import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

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
      'Project permission matrix. Missing domains or actions default to false.',
    example: {
      projectManagement: {
        create: false,
        update: true,
        view: true,
        delete: false,
      },
      taskManagement: { create: true, update: true, view: true, delete: false },
    },
  })
  @IsObject()
  permissions: Record<string, Record<string, boolean>>;
}
