import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';
import { ProjectStatus, ProjectType } from '../entities/project.entity';

export class ProjectFiltersDto extends ListFilterDTO {
  @ApiPropertyOptional({ enum: ProjectType })
  @IsEnum(ProjectType)
  @IsOptional()
  type?: ProjectType;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @ApiPropertyOptional({ example: 'uuid-of-template' })
  @IsUUID()
  @IsOptional()
  templateId?: string;
}
