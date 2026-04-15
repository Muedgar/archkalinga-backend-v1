import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { ProjectStatus, ProjectType } from '../entities/project.entity';

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
}
