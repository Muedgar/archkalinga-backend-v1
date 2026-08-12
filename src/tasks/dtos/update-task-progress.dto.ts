import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateTaskProgressDto {
  @ApiProperty({ example: 72 })
  @IsInt()
  @Min(0)
  @Max(100)
  progress: number;

  @ApiPropertyOptional({ example: 'manual' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  source?: string;

  @ApiPropertyOptional({ example: 'Site report update' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Type(() => String)
  note?: string;
}
