import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ActivityScheduleImportMode {
  VALIDATE_ONLY = 'validateOnly',
  UPSERT_BY_WBS = 'upsertByWbs',
}

export class ActivityScheduleImportDto {
  @ApiPropertyOptional({
    enum: ActivityScheduleImportMode,
    default: ActivityScheduleImportMode.VALIDATE_ONLY,
    description:
      'validateOnly parses and reports issues without writes. upsertByWbs writes only after validation passes.',
  })
  @IsOptional()
  @IsEnum(ActivityScheduleImportMode)
  mode?: ActivityScheduleImportMode = ActivityScheduleImportMode.VALIDATE_ONLY;
}
