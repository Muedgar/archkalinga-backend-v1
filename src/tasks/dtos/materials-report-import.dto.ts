import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum MaterialsReportImportMode {
  VALIDATE_ONLY = 'validateOnly',
  APPEND = 'append',
  REPLACE_BY_TASK = 'replaceByTask',
}

export class MaterialsReportImportDto {
  @ApiPropertyOptional({
    enum: MaterialsReportImportMode,
    default: MaterialsReportImportMode.VALIDATE_ONLY,
    description:
      'validateOnly parses and reports issues without writes. append inserts rows after validation. replaceByTask deletes existing materials for matched task codes, then inserts rows from the workbook.',
  })
  @IsOptional()
  @IsEnum(MaterialsReportImportMode)
  mode?: MaterialsReportImportMode = MaterialsReportImportMode.VALIDATE_ONLY;
}
