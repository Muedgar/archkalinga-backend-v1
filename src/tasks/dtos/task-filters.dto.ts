import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';

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

  @ApiPropertyOptional({ example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e' })
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({ example: 'e1c2a3b4-d5e6-7f89-a0b1-c2d3e4f50001' })
  @IsOptional()
  @IsUUID()
  priorityId?: string;

  @ApiPropertyOptional({ example: 'f1a2b3c4-d5e6-7f89-a0b1-c2d3e4f50002' })
  @IsOptional()
  @IsUUID()
  taskTypeId?: string;

  @ApiPropertyOptional({ example: 'a0b1c2d3-e4f5-6789-a0b1-c2d3e4f50003' })
  @IsOptional()
  @IsUUID()
  severityId?: string;

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
