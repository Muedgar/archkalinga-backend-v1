import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
}

export enum TaskTimelineScope {
  TASK = 'task',
  SUBTREE = 'subtree',
}

export enum TaskTimelineOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class TaskTimelineQueryDto {
  @ApiPropertyOptional({
    enum: TaskTimelineScope,
    default: TaskTimelineScope.TASK,
  })
  @IsOptional()
  @IsIn(Object.values(TaskTimelineScope))
  scope?: TaskTimelineScope;

  @ApiPropertyOptional({
    example: '2026-07-01T00:00:00.000Z',
    description: 'Include events at or after this timestamp.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-07-26T23:59:59.999Z',
    description: 'Include events at or before this timestamp.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: TaskTimelineOrder,
    default: TaskTimelineOrder.ASC,
  })
  @IsOptional()
  @IsIn(Object.values(TaskTimelineOrder))
  order?: TaskTimelineOrder;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 100, default: 100 })
  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({
    example: 25,
    description:
      'Maximum current hierarchy depth to traverse for subtree scope.',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(0)
  @Max(25)
  depth?: number;
}
