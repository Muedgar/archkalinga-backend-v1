import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class UpdateChecklistItemDto {
  @ApiPropertyOptional({ example: 'Adjusted checklist line' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Type(() => String)
  text?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}
