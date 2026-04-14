import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';
import { TaskPriority, TaskStatus } from '../entities/task.entity';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return undefined;
}

export class TaskFiltersDto extends ListFilterDTO {
  @ApiPropertyOptional({ example: 'root' })
  @IsOptional()
  @IsString()
  parentTaskId?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reporteeUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectRoleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workflowColumnId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDateTo?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  hasIncompleteChecklist?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({
    example:
      'assignedMembers,reportee,checklist,comments,dependencies,viewMeta',
    description:
      'Comma-separated list of allowed relations: assignedMembers, reportee, checklist, dependencies, comments, viewMeta.',
  })
  @IsOptional()
  @IsString()
  include?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  flat?: boolean;
}
