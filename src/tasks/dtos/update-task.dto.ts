import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
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
import { TaskPriority, TaskStatus } from '../entities/task.entity';
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

  @ApiPropertyOptional({ example: 'Updated task description' })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  @Type(() => String)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskStatus, example: TaskStatus.IN_PROGRESS })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e' })
  @IsOptional()
  @IsUUID()
  workflowColumnId?: string | null;

  @ApiPropertyOptional({ enum: TaskPriority, example: TaskPriority.URGENT })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority | null;

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
    description: 'Assigned project members with their active project-role linkage',
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

  @ApiPropertyOptional({ type: () => TaskViewMetaDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TaskViewMetaDto)
  viewMeta?: TaskViewMetaDto;
}
