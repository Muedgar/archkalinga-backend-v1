import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
}

export class FieldWorkQueueQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Defaults to the server current date.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeCompleted?: boolean;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  @Max(250)
  limit?: number;
}
