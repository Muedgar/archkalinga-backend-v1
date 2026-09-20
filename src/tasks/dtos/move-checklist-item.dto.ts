import { WorkflowRevisionDto } from './checklist-workflow.dto';
import { IsIn } from 'class-validator';
import type { WorkflowIntent } from '../workflow/checklist-policy';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class MoveChecklistItemDto extends WorkflowRevisionDto {
  @ApiPropertyOptional({
    enum: ['MOVE', 'SUBMIT', 'ACCEPT', 'REJECT', 'WITHDRAW'],
  })
  @IsOptional()
  @IsIn(['MOVE', 'SUBMIT', 'ACCEPT', 'REJECT', 'WITHDRAW'])
  intent?: WorkflowIntent;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  reviewNote?: string;

  @ApiProperty({
    example: 'a1b2c3d4-...',
    description: 'Target project status UUID for checklist Kanban movement.',
  })
  @IsUUID()
  statusId: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-...',
    description: 'Place this item before another checklist item.',
  })
  @IsOptional()
  @IsUUID()
  beforeItemId?: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-...',
    description: 'Place this item after another checklist item.',
  })
  @IsOptional()
  @IsUUID()
  afterItemId?: string;

  @ApiPropertyOptional({ example: 'Ready for review' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Type(() => String)
  reason?: string;
}
