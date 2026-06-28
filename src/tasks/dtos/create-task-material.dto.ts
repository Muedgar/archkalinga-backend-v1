import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateTaskMaterialDto {
  @ApiPropertyOptional({
    example: '1',
    description: 'Source material takeoff Phase ID.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  phaseCode?: string | null;

  @ApiPropertyOptional({
    example: '1.1',
    description: 'Source material takeoff Stage ID.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  stageCode?: string | null;

  @ApiPropertyOptional({
    example: '1.1.1',
    description: 'Source material takeoff Activity ID.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  activityCode?: string | null;

  @ApiPropertyOptional({
    example: 'Mobilization Activities',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Type(() => String)
  activityName?: string | null;

  @ApiPropertyOptional({
    example: '1.1.1.3',
    description: 'Source material takeoff Task ID, stored separately from the task UUID.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  taskCode?: string | null;

  @ApiPropertyOptional({
    example: 'Temporary facilities (site office, storage, sanitation)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Type(() => String)
  taskName?: string | null;

  @ApiProperty({ example: 'Miscellaneous' })
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  materialCategory: string;

  @ApiProperty({ example: 'Timber (40 x50)' })
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  materialName: string;

  @ApiPropertyOptional({ example: 'pcs', nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Type(() => String)
  unit?: string | null;

  @ApiProperty({ example: 120 })
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  quantity: number;

  @ApiPropertyOptional({ example: 1800, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  defaultRate?: number | null;

  @ApiPropertyOptional({
    example: 10,
    description: 'Waste percentage as a whole percent value from the source sheet.',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9999.9999)
  wastePercent?: number | null;

  @ApiPropertyOptional({ example: 237600, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  materialCost?: number | null;

  @ApiPropertyOptional({ example: 'RWF', default: 'RWF' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Type(() => String)
  currency?: string;

  @ApiPropertyOptional({ example: 'OK', nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Type(() => String)
  lookupStatus?: string | null;
}
