import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpdateChecklistGroupDto {
  @ApiPropertyOptional({ example: 'Acceptance Criteria' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  title?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}
