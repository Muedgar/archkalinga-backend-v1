import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { TaskSyncEventType } from '../entities';

export class TaskSyncEventDto {
  @ApiProperty({ example: 'mobile-evt-000001' })
  @IsString()
  @Length(1, 120)
  @Type(() => String)
  clientEventId: string;

  @ApiProperty({
    enum: TaskSyncEventType,
    example: TaskSyncEventType.CHECKLIST_ITEM_TOGGLED,
  })
  @IsEnum(TaskSyncEventType)
  type: TaskSyncEventType;

  @ApiProperty({ example: '3d0a318d-d0e8-44ea-b3d7-c8bce1ff847b' })
  @IsUUID()
  taskId: string;

  @ApiProperty({ example: '2026-08-01T08:30:00.000Z' })
  @IsDateString()
  occurredAt: string;

  @ApiProperty({
    example: {
      checklistItemId: '4d0a318d-d0e8-44ea-b3d7-c8bce1ff847b',
      completed: true,
    },
  })
  @IsObject()
  payload: Record<string, unknown>;
}

export class TaskSyncEventsDto {
  @ApiProperty({ type: () => [TaskSyncEventDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaskSyncEventDto)
  events: TaskSyncEventDto[];
}
