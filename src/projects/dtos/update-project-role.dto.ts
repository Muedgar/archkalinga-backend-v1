import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateProjectRoleDto } from './create-project-role.dto';

export class UpdateProjectRoleDto extends PartialType(CreateProjectRoleDto) {
  @IsOptional()
  @IsBoolean()
  status?: boolean;
}
