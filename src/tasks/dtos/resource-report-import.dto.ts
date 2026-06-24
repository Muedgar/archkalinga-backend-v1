import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ResourceReportImportMode {
  VALIDATE_ONLY = 'validateOnly',
  REPLACE_BY_ACTIVITY = 'replaceByActivity',
}

export class ResourceReportImportDto {
  @ApiPropertyOptional({
    enum: ResourceReportImportMode,
    default: ResourceReportImportMode.VALIDATE_ONLY,
    description:
      'validateOnly parses and reports issues without writes. replaceByActivity replaces existing allocations for matched activity codes, then inserts rows from the workbook.',
  })
  @IsOptional()
  @IsEnum(ResourceReportImportMode)
  mode?: ResourceReportImportMode = ResourceReportImportMode.VALIDATE_ONLY;
}
