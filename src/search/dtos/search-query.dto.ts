import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const SEARCH_RESULT_TYPES = [
  'project',
  'task',
  'template',
  'user',
  'document',
  'change_request',
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

function toPositiveLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(Math.max(Math.trunc(numeric), 1), 50);
}

function toTypeList(value: unknown): SearchResultType[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    return value.flatMap((item) => toTypeList(item) ?? []);
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is SearchResultType =>
      SEARCH_RESULT_TYPES.includes(item as SearchResultType),
    );
}

export class SearchQueryDto {
  @ApiPropertyOptional({ example: 'ramba' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 8, minimum: 1, maximum: 50 })
  @Transform(({ value }) => toPositiveLimit(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 8;

  @ApiPropertyOptional({
    example: 'project,task,template,user,document',
    description: 'Comma-separated result types to include.',
  })
  @Transform(({ value }) => toTypeList(value))
  @IsOptional()
  @IsIn(SEARCH_RESULT_TYPES, { each: true })
  types?: SearchResultType[];

  @ApiPropertyOptional({ example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
