import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { ProjectType } from '../entities/project.entity';

export class CreateProjectDto {
  @ApiProperty({ example: 'Kigali Office Fitout' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 200)
  title: string;

  @ApiProperty({ example: 'Interior and coordination package' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 2000)
  description: string;

  @ApiProperty({ example: '2026-03-20' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiProperty({ enum: ProjectType, example: ProjectType.INTERIOR })
  @IsEnum(ProjectType)
  type: ProjectType;

  @ApiProperty({ example: 'uuid-of-template' })
  @IsUUID()
  templateId: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['uuid-1', 'uuid-2'],
    description:
      'Optional list of user UUIDs to add as project members from the same organization. Added users receive the default Contributor project role.',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMinSize(1)
  @IsOptional()
  @Type(() => String)
  memberIds?: string[];
}
