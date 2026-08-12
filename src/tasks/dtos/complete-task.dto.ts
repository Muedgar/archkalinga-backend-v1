import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { TaskCompletionMode } from '../types/task-completion-mode.type';

export class CompleteTaskDto {
  @ApiPropertyOptional({
    description:
      'Done status to move the task into. Defaults to the single active Done status for the project.',
  })
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({
    enum: TaskCompletionMode,
    default: TaskCompletionMode.APPLY_STATUS_POLICY,
  })
  @IsOptional()
  @IsEnum(TaskCompletionMode)
  completionMode?: TaskCompletionMode;

  @ApiPropertyOptional({ example: 'Field work confirmed' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Type(() => String)
  reason?: string;
}
