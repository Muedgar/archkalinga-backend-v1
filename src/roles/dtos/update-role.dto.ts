import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateRoleDTO {
  @ApiPropertyOptional({ example: 'Reviewer' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Full permission matrix to replace the current one.',
  })
  @IsOptional()
  @IsObject()
  permissions?: Record<string, Record<string, boolean>>;
}
