import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class UpdateTaskLocationProgressDto {
  @ApiPropertyOptional({ example: 65, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @ApiPropertyOptional({ example: 'in_progress', nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Type(() => String)
  status?: string | null;

  @ApiPropertyOptional({ example: 0.75, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualQuantity?: number | null;

  @ApiPropertyOptional({
    example: 'Access blocked by locked unit.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  siteNote?: string | null;

  @ApiPropertyOptional({ example: '2026-08-01T08:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  reportedAt?: string | null;
}
