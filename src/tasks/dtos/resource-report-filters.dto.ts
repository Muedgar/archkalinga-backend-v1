import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';

export enum ResourceReportFormat {
  JSON = 'json',
  XLSX = 'xlsx',
}

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return undefined;
}

export class ResourceReportFiltersDto extends ListFilterDTO {
  @ApiPropertyOptional({
    example: '7fdff8c1-9da2-43e8-bf08-875b9278fc35',
    description: 'Filter allocations for one task UUID.',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({
    example: '1',
    description: 'Filter by report Phase ID.',
  })
  @IsOptional()
  @IsString()
  phaseCode?: string;

  @ApiPropertyOptional({
    example: '1.1',
    description: 'Filter by report Stage ID.',
  })
  @IsOptional()
  @IsString()
  stageCode?: string;

  @ApiPropertyOptional({
    example: '1.1.1',
    description: 'Filter by report Activity ID.',
  })
  @IsOptional()
  @IsString()
  activityCode?: string;

  @ApiPropertyOptional({
    example: 'Labor',
    description: 'Filter by resource type, such as Labor, Labor_Team, or Equipment.',
  })
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional({
    example: 'General Worker',
    description: 'Filter by resource name.',
  })
  @IsOptional()
  @IsString()
  resourceName?: string;

  @ApiPropertyOptional({
    example: 'OK',
    description: 'Filter by resource report status.',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Include generated activity, stage, and phase subtotal rows in the report response.',
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeSummaryRows?: boolean;

  @ApiPropertyOptional({
    enum: ResourceReportFormat,
    default: ResourceReportFormat.JSON,
    description: 'Requested report format for endpoints that support content negotiation.',
  })
  @IsOptional()
  @IsEnum(ResourceReportFormat)
  format?: ResourceReportFormat = ResourceReportFormat.JSON;
}
