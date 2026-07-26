import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TaskAssignedMemberDto } from './create-task.dto';

export class BranchChecklistItemDto {
  @ApiPropertyOptional({
    example: 'Survey apartment block A',
    description: 'Optional child task title. Defaults to the checklist text.',
  })
  @IsOptional()
  @IsString()
  @Length(2, 500)
  @Type(() => String)
  title?: string;

  @ApiPropertyOptional({
    example: 'CHK-001',
    description:
      'Permanent checklist item code used by Task Force/Kanban branch views.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  itemCode?: string | null;

  @ApiPropertyOptional({
    example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e',
    description:
      'Status for the child task. Defaults to the project default status.',
  })
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({
    example: 'f1a2b3c4-d5e6-7f89-a0b1-c2d3e4f50002',
    description:
      'Task type for the child task. Defaults to the project default task type.',
  })
  @IsOptional()
  @IsUUID()
  taskTypeId?: string;

  @ApiPropertyOptional({ example: '2026-08-01', nullable: true })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ example: '2026-08-03', nullable: true })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number | null;

  @ApiPropertyOptional({ example: '2.2.3.4.1', nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  wbsCode?: string | null;

  @ApiPropertyOptional({ example: 10, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  weightPercent?: number | null;

  @ApiPropertyOptional({
    type: () => [TaskAssignedMemberDto],
    description: 'Optional assignees for the child task.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskAssignedMemberDto)
  assignedMembers?: TaskAssignedMemberDto[];
}
