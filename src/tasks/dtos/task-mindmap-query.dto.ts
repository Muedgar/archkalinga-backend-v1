import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum TaskMindmapCollapsedMode {
  RESPECT = 'respect',
  IGNORE = 'ignore',
}

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

export class TaskMindmapQueryDto {
  @ApiPropertyOptional({
    example: 'all',
    description:
      'How many descendant levels to return. Use all for the full visible subtree.',
  })
  @IsOptional()
  @Transform(({ value }) => toDepth(value))
  depth?: number | 'all';

  @ApiPropertyOptional({
    example: 500,
    description: 'Maximum number of task nodes to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({
    example: 'checklist,counts,progress,status,viewMeta,permissions,requests',
    description:
      'Comma-separated includes: checklist, counts, progress, status, assignees, dependencies, requests, linkedTasks, viewMeta, permissions, activitySchedule.',
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
    enum: TaskMindmapCollapsedMode,
    default: TaskMindmapCollapsedMode.RESPECT,
  })
  @IsOptional()
  @IsEnum(TaskMindmapCollapsedMode)
  collapsedMode?: TaskMindmapCollapsedMode;
}
