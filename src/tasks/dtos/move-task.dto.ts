import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class MoveTaskDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  parentTaskId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  workflowColumnId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  beforeTaskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  afterTaskId?: string;
}
