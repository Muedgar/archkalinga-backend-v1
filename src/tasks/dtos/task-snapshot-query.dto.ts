import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { TaskTimelineScope } from './task-timeline-query.dto';

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
}

export class TaskSnapshotQueryDto {
  @ApiProperty({
    example: '2026-07-01T00:00:00.000Z',
    description: 'Snapshot cutoff timestamp.',
  })
  @IsDateString()
  asOf: string;

  @ApiPropertyOptional({
    enum: TaskTimelineScope,
    default: TaskTimelineScope.TASK,
  })
  @IsOptional()
  @IsIn(Object.values(TaskTimelineScope))
  scope?: TaskTimelineScope;

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
