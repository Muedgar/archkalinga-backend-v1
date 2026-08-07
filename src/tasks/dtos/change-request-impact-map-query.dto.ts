import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  ChangeRequestImpactType,
  ChangeRequestPriority,
  ChangeRequestStatus,
} from '../entities';
import { TaskMindmapCollapsedMode } from './task-mindmap-query.dto';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return undefined;
}

function toDepth(value: unknown): number | 'all' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'all') return 'all';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : (value as never);
}

export class ChangeRequestImpactMapQueryDto {
  @ApiPropertyOptional({
    example: 'all',
    description:
      'How many descendant levels to include under the root task. Use all for the full visible subtree.',
  })
  @IsOptional()
  @Transform(({ value }) => toDepth(value))
  depth?: number | 'all';

  @ApiPropertyOptional({
    example: 500,
    description: 'Maximum number of task nodes to consider.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeCompleted?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeSuperseded?: boolean;

  @ApiPropertyOptional({
    enum: TaskMindmapCollapsedMode,
    default: TaskMindmapCollapsedMode.RESPECT,
    description:
      'Whether stored collapsed mindmap nodes should hide descendant task impact summaries.',
  })
  @IsOptional()
  @IsEnum(TaskMindmapCollapsedMode)
  collapsedMode?: TaskMindmapCollapsedMode;

  @ApiPropertyOptional({ enum: ChangeRequestStatus })
  @IsOptional()
  @IsEnum(ChangeRequestStatus)
  status?: ChangeRequestStatus;

  @ApiPropertyOptional({ enum: ChangeRequestImpactType })
  @IsOptional()
  @IsEnum(ChangeRequestImpactType)
  impactType?: ChangeRequestImpactType;

  @ApiPropertyOptional({ enum: ChangeRequestPriority })
  @IsOptional()
  @IsEnum(ChangeRequestPriority)
  priority?: ChangeRequestPriority;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  escalatedToUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  reviewerUserId?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Filter requests that need action from the current user, such as a pending review or returned revision.',
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  needsMyAttention?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Include lightweight change-request preview items per task.',
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeItems?: boolean;

  @ApiPropertyOptional({
    example: 3,
    default: 3,
    description:
      'Maximum number of lightweight change-request preview items to return per affected task.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  itemLimitPerTask?: number;
}
