import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { TaskCompletionMode } from '../types/task-completion-mode.type';

export class MoveTaskDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  parentTaskId?: string | null;

  // Phase 1: replaces workflowColumnId — references project_statuses.id
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  statusId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  beforeTaskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  afterTaskId?: string;

  @ApiPropertyOptional({
    enum: TaskCompletionMode,
    default: TaskCompletionMode.APPLY_STATUS_POLICY,
  })
  @IsOptional()
  @IsEnum(TaskCompletionMode)
  completionMode?: TaskCompletionMode;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number | null;

  @ApiPropertyOptional({ example: 'Field work confirmed' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Type(() => String)
  reason?: string;
}
