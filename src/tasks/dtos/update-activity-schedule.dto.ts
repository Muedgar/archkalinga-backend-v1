import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class UpdateActivityScheduleDto {
  @ApiPropertyOptional({
    example: 5,
    description: 'Working-day duration used by activity schedule calculations.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999.99)
  durationDays?: number | null;

  @ApiPropertyOptional({
    example: '2026-06-15',
    nullable: true,
    description: 'Planned start date. Can be manually pinned with a reason.',
  })
  @IsOptional()
  @IsDateString()
  plannedStartDate?: string | null;

  @ApiPropertyOptional({
    example: '2026-06-20',
    nullable: true,
    description: 'Planned end date. Can be manually pinned with a reason.',
  })
  @IsOptional()
  @IsDateString()
  plannedEndDate?: string | null;

  @ApiPropertyOptional({
    example: '2026-06-16',
    nullable: true,
    description: 'Actual start date captured during execution.',
  })
  @IsOptional()
  @IsDateString()
  actualStartDate?: string | null;

  @ApiPropertyOptional({
    example: '2026-06-22',
    nullable: true,
    description: 'Actual end date captured during execution.',
  })
  @IsOptional()
  @IsDateString()
  actualEndDate?: string | null;

  @ApiPropertyOptional({
    example: true,
    description:
      'Marks schedule values as manually pinned instead of calculator-owned.',
  })
  @IsOptional()
  @IsBoolean()
  isManuallyScheduled?: boolean;

  @ApiPropertyOptional({
    example: 'Pinned to match client-approved site access window.',
    nullable: true,
    description: 'Required when manually pinning schedule values.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  manualReason?: string | null;
}
