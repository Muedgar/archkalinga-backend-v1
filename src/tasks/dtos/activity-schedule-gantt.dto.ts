import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';

export enum ActivityScheduleGanttScale {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  QUARTER = 'quarter',
}

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return undefined;
}

export class ActivityScheduleGanttQueryDto extends ListFilterDTO {
  @ApiPropertyOptional({
    example: '2026-04-13',
    description:
      'First visible week. The service snaps this date back to Monday.',
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
  weeks?: number;

  @ApiPropertyOptional({
    enum: ActivityScheduleGanttScale,
    default: ActivityScheduleGanttScale.WEEK,
  })
  @IsOptional()
  @IsEnum(ActivityScheduleGanttScale)
  scale?: ActivityScheduleGanttScale;

  @ApiPropertyOptional({
    example: true,
    description: 'Include phase/stage summary rows in the Gantt feed.',
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeSummaryRows?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Only return rows currently marked critical.',
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  criticalOnly?: boolean;
}

export class UpsertProjectCalendarDto {
  @ApiPropertyOptional({ example: 'Africa/Kigali' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  timezone?: string;

  @ApiPropertyOptional({
    example: [1, 2, 3, 4, 5],
    description: 'Working weekdays using JavaScript UTC day numbers: Sunday=0.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingWeekdays?: number[];

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(24)
  defaultHoursPerDay?: number;
}

export class CreateProjectCalendarExceptionDto {
  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  isWorkingDay: boolean;

  @ApiPropertyOptional({ example: 'Independence Day' })
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiPropertyOptional({ example: 'National holiday', nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string | null;
}

export class UpdateProjectCalendarExceptionDto {
  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isWorkingDay?: boolean;

  @ApiPropertyOptional({ example: 'Independence Day' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ example: 'National holiday', nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string | null;
}
