import {
  IsObject,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ChecklistDefinitionDependencyDto } from './checklist-definition-dependency.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class UpdateChecklistItemDto {
  @ApiPropertyOptional() @IsOptional() @IsObject() description?: Record<
    string,
    unknown
  > | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  durationDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() earliestStartDate?:
    | string
    | null;
  @ApiPropertyOptional({ type: [ChecklistDefinitionDependencyDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistDefinitionDependencyDto)
  dependencies?: ChecklistDefinitionDependencyDto[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedRevision?: number;

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

  @ApiPropertyOptional({
    example: 'a1b2c3d4-...',
    description:
      'Project status UUID used for checklist Kanban column placement.',
  })
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({
    example: '0000001000',
    nullable: true,
    description: 'Checklist Kanban rank within the status column.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Type(() => String)
  rank?: string | null;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-...',
    description:
      'Move item to a different checklist group, or null to ungroupit',
  })
  @IsOptional()
  @IsUUID()
  checklistGroupId?: string | null;

  @ApiPropertyOptional({
    example: 'CHK-001',
    nullable: true,
    description: 'Optional permanent checklist item code within this task.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  itemCode?: string | null;
}
