import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export class TemplateTaskDto {
  @ApiProperty({ example: 'Initiation' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 120)
  @Type(() => String)
  name: string;

  @ApiProperty({ example: 'Project setup and alignment' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 500)
  @Type(() => String)
  description: string;

  @ApiPropertyOptional({ type: () => [TemplateTaskDto], default: [] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateTaskDto)
  subtasks: TemplateTaskDto[];
}

export class CreateTemplateDto {
  @ApiProperty({ example: 'Residential Build' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 80)
  @Type(() => String)
  name: string;

  @ApiProperty({ example: 'Template for a standard residential project' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 800)
  @Type(() => String)
  description: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  isDefault: boolean;

  @ApiProperty({ type: () => [TemplateTaskDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TemplateTaskDto)
  tasks: TemplateTaskDto[];
}
