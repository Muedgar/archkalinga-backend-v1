import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { TemplateTaskDto } from './create-template.dto';

export class UpdateTemplateDto {
  @ApiPropertyOptional({ example: 'Residential Build v2' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Type(() => String)
  name?: string;

  @ApiPropertyOptional({ example: 'Updated template description' })
  @IsOptional()
  @IsString()
  @Length(2, 800)
  @Type(() => String)
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: () => [TemplateTaskDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateTaskDto)
  tasks?: TemplateTaskDto[];
}
