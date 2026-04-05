import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateRoleDTO {
  @ApiPropertyOptional({ example: 'Workspace Reviewer' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Full workspace permission matrix to replace the current one.',
  })
  @IsOptional()
  @IsObject()
  permissions?: Record<string, Record<string, boolean>>;
}
