import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return undefined;
}

export class ActivityScheduleFiltersDto extends ListFilterDTO {
  @ApiPropertyOptional({
    example: true,
    description:
      'Include phase/stage summary rows in addition to activity rows.',
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

  @ApiPropertyOptional({
    example: 'root',
    description:
      'Filter by parent task UUID. Use root to return top-level scheduled rows.',
  })
  @IsOptional()
  @IsString()
  parentTaskId?: string;

  @ApiPropertyOptional({
    example: '7fdff8c1-9da2-43e8-bf08-875b9278fc35',
    description: 'Optional task UUID used as a branch root.',
  })
  @IsOptional()
  @IsUUID()
  branchTaskId?: string;
}
