import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { DependencyType } from '../entities';

class CreateTaskChecklistItemDto {
  @ApiProperty({ example: 'Collect reference images' })
  @IsString()
  @Length(1, 500)
  @Type(() => String)
  text: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  orderIndex: number;
}

class MindmapMetaDto {
  @ApiPropertyOptional({ example: 320 })
  @IsOptional()
  @IsInt()
  x?: number;

  @ApiPropertyOptional({ example: 160 })
  @IsOptional()
  @IsInt()
  y?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  collapsed?: boolean;
}

class GanttMetaDto {
  @ApiPropertyOptional({ example: '#1D4ED8' })
  @IsOptional()
  @IsString()
  @Length(3, 50)
  barColor?: string;
}

class TaskViewMetaDto {
  @ApiPropertyOptional({ type: () => MindmapMetaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MindmapMetaDto)
  mindmap?: MindmapMetaDto;

  @ApiPropertyOptional({ type: () => GanttMetaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GanttMetaDto)
  gantt?: GanttMetaDto;
}

class TaskAssignedMemberDto {
  @ApiProperty({ example: '3d0a318d-d0e8-44ea-b3d7-c8bce1ff847b' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 'd0a81cc2-3f86-4eb2-b4db-f4adb6152d63' })
  @IsUUID()
  projectRoleId: string;
}

class TaskReporteeDto {
  @ApiProperty({ example: '57975d05-f54e-40d0-b7f7-f339a0be451f' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 'd0a81cc2-3f86-4eb2-b4db-f4adb6152d63' })
  @IsUUID()
  projectRoleId: string;
}

export class CreateTaskDto {
  @ApiPropertyOptional({ example: 'b953ef8f-a9b4-4f06-8b72-c8e29a5b6ea7' })
  @IsOptional()
  @IsUUID()
  parentTaskId?: string | null;

  @ApiProperty({ example: 'Develop structural concepts' })
  @IsString()
  @Length(2, 500)
  @Type(() => String)
  title: string;

  @ApiPropertyOptional({
    example: { type: 'doc', content: [] },
    description: 'Rich-text content as a ProseMirror/TipTap JSON document.',
  })
  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: '3a42068b-6f82-40b1-926b-6c2244d07d29',
    description: 'UUID of the project status to assign. Defaults to the project default status.',
  })
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({
    example: 'e1c2a3b4-d5e6-7f89-a0b1-c2d3e4f50001',
    description: 'UUID of the project priority to assign.',
  })
  @IsOptional()
  @IsUUID()
  priorityId?: string;

  @ApiPropertyOptional({
    example: 'f1a2b3c4-d5e6-7f89-a0b1-c2d3e4f50002',
    description: 'UUID of the project task type. Defaults to the project default task type.',
  })
  @IsOptional()
  @IsUUID()
  taskTypeId?: string;

  @ApiPropertyOptional({
    example: 'a0b1c2d3-e4f5-6789-a0b1-c2d3e4f50003',
    description: 'UUID of the project severity (optional).',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  severityId?: string | null;

  @ApiPropertyOptional({ example: '2026-03-25' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-04-05' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({
    type: () => [TaskAssignedMemberDto],
    description:
      'Assigned project members with their active project-role linkage. Optional at initial creation.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaskAssignedMemberDto)
  assignedMembers?: TaskAssignedMemberDto[];

  @ApiPropertyOptional({
    type: () => TaskReporteeDto,
    description:
      'Reportee member with project-role context. Optional at initial creation.',
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

export {
  CreateTaskChecklistItemDto,
  GanttMetaDto,
  MindmapMetaDto,
  TaskAssignedMemberDto,
  TaskReporteeDto,
  TaskViewMetaDto,
};
