import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { ProjectStatus, ProjectType } from '../entities/project.entity';
import { MemberRoleAssignmentDto } from './member-role-assignment.dto';

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: 'Kigali Office Fitout Phase 2' })
  @IsString()
  @Length(2, 200)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated scope and coordination package' })
  @IsString()
  @Length(2, 2000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-03-25' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-07-15' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ enum: ProjectType })
  @IsEnum(ProjectType)
  @IsOptional()
  type?: ProjectType;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @ApiPropertyOptional({
    example: 'uuid-of-new-template',
    description: 'Allowed only before project tasks have been created.',
  })
  @IsUUID()
  @IsOptional()
  templateId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['uuid-1', 'uuid-2', 'uuid-3'],
    description:
      'Replaces the active member list. Removed members are soft-removed, new ones are added with the default Contributor project role.',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMinSize(1)
  @IsOptional()
  @Type(() => String)
  memberIds?: string[];

  @ApiPropertyOptional({
    type: [MemberRoleAssignmentDto],
    description:
      'Replaces the active member list with explicit member-role assignments. When supplied, projectRoleId controls each member role and omitted role IDs default to Contributor.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberRoleAssignmentDto)
  @IsOptional()
  memberAssignments?: MemberRoleAssignmentDto[];
}
