import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return undefined;
}

function toDepth(value: unknown): number | 'all' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'all') return 'all';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : (value as never);
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
}

export class TaskTreeQueryDto {
  @ApiPropertyOptional({
    example: 'all',
    description:
      'How many descendant levels to return. Use all for the full subtree.',
  })
  @IsOptional()
  @Transform(({ value }) => toDepth(value))
  depth?: number | 'all';

  @ApiPropertyOptional({
    example: 'checklist,assignees,status,progress,counts',
    description:
      'Comma-separated includes: checklist, assignees, dependencies, comments, viewMeta, activitySchedule, counts, progress, status.',
  })
  @IsOptional()
  @IsString()
  include?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeCompleted?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeSuperseded?: boolean;

  @ApiPropertyOptional({
    example: 500,
    description: 'Maximum number of task nodes to return.',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
