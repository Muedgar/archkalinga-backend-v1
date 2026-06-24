import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateTaskResourceAllocationDto {
  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  phaseCode?: string | null;

  @ApiPropertyOptional({ example: 'Admin & Site Setup' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  phaseName?: string | null;

  @ApiPropertyOptional({ example: '1.1' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  stageCode?: string | null;

  @ApiPropertyOptional({ example: 'Mobilization & Logistics' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  stageName?: string | null;

  @ApiPropertyOptional({ example: '1.1.1' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  activityCode?: string | null;

  @ApiPropertyOptional({ example: 'Mobilization Activities' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  activityName?: string | null;

  @ApiProperty({ example: 'Labor' })
  @IsString()
  @Length(1, 100)
  resourceType: string;

  @ApiProperty({ example: 'General Worker' })
  @IsString()
  @Length(1, 255)
  resourceName: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  quantity: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99999999.99)
  durationDays?: number | null;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  defaultRate?: number | null;

  @ApiPropertyOptional({ example: 6500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  overrideRate?: number | null;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  effectiveRate?: number | null;

  @ApiPropertyOptional({ example: 180000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  costAmount?: number | null;

  @ApiPropertyOptional({ example: 'RWF', default: 'RWF' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: 'OK' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  status?: string | null;
}
