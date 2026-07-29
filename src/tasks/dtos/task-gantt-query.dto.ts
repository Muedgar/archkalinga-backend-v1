import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ActivityScheduleGanttScale } from './activity-schedule-gantt.dto';

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

export class TaskGanttQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-03',
    description:
      'First visible timeline date. The service snaps this date to the selected scale boundary.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: 36, minimum: 1, maximum: 260 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(260)
  periods?: number;

  @ApiPropertyOptional({
    enum: ActivityScheduleGanttScale,
    default: ActivityScheduleGanttScale.WEEK,
  })
  @IsOptional()
  @IsEnum(ActivityScheduleGanttScale)
  scale?: ActivityScheduleGanttScale;

  @ApiPropertyOptional({
    example: 'all',
    description:
      'How many descendant levels under the root task to include. Use all for the full visible subtree.',
  })
  @IsOptional()
  @Transform(({ value }) => toDepth(value))
  depth?: number | 'all';

  @ApiPropertyOptional({ example: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({
    example: '100',
    description: 'Zero-based row offset cursor. Omit for the first row window.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    example: 'dependencies,milestones,criticalPath,viewMeta,permissions',
    description:
      'Comma-separated includes: dependencies, milestones, criticalPath, viewMeta, permissions, assignees, calendar, checks.',
  })
  @IsOptional()
  @IsString()
  include?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeSummaryRows?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  criticalOnly?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional({ example: 'construction' })
  @IsOptional()
  @IsString()
  track?: string;

  @ApiPropertyOptional({ example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e' })
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @ApiPropertyOptional({ example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e' })
  @IsOptional()
  @IsUUID()
  statusId?: string;
}
