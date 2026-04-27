import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
// IsString and Length are still used for `title` below
import {
  CreateTaskChecklistItemDto,
  TaskAssignedMemberDto,
  TaskReporteeDto,
  TaskViewMetaDto,
} from './create-task.dto';

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'Refine concepts' })
  @IsOptional()
  @IsString()
  @Length(2, 500)
  @Type(() => String)
  title?: string;

  @ApiPropertyOptional({
    example: { type: 'doc', content: [] },
    description: 'Rich-text content as a ProseMirror/TipTap JSON document.',
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  description?: Record<string, unknown> | null;

  @ApiPropertyOptional({ example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e' })
  @IsOptional()
  @IsUUID()
  statusId?: string | null;

  @ApiPropertyOptional({ example: 'e1c2a3b4-d5e6-7f89-a0b1-c2d3e4f50001', nullable: true })
  @IsOptional()
  @IsUUID()
  priorityId?: string | null;

  @ApiPropertyOptional({ example: 'f1a2b3c4-d5e6-7f89-a0b1-c2d3e4f50002' })
  @IsOptional()
  @IsUUID()
  taskTypeId?: string;

  @ApiPropertyOptional({ example: 'a0b1c2d3-e4f5-6789-a0b1-c2d3e4f50003', nullable: true })
  @IsOptional()
  @IsUUID()
  severityId?: string | null;

  @ApiPropertyOptional({ example: '2026-03-25' })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ example: '2026-04-05' })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ example: 65 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number | null;

  @ApiPropertyOptional({
    type: () => [TaskAssignedMemberDto],
    description:
      'Assigned project members with their active project-role linkage',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaskAssignedMemberDto)
  assignedMembers?: TaskAssignedMemberDto[];

  @ApiPropertyOptional({
    type: () => TaskReporteeDto,
    description: 'Reportee member with project-role context',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskReporteeDto)
  reportee?: TaskReporteeDto;

  @ApiPropertyOptional({ type: () => [CreateTaskChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTaskChecklistItemDto)
  checklistItems?: CreateTaskChecklistItemDto[];

  @ApiPropertyOptional({ type: [String], description: 'Predecessor task ids' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  dependencyIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description: 'ProjectLabel UUIDs to assign to this task. Pass an empty array [] to clear all labels.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  labelIds?: string[] | null;

  @ApiPropertyOptional({ type: () => TaskViewMetaDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TaskViewMetaDto)
  viewMeta?: TaskViewMetaDto;
}
