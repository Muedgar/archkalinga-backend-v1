import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

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
}
