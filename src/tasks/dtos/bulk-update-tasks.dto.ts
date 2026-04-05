import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TaskStatus } from '../entities/task.entity';
import { TaskViewMetaDto } from './create-task.dto';

class BulkTaskUpdateItemDto {
  @ApiProperty()
  @IsUUID()
  taskId: string;

  @ApiProperty({ required: false, enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiProperty({ required: false, example: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiProperty({ required: false, example: '2026-04-09' })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiProperty({ required: false, example: '2026-04-18' })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  parentTaskId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  workflowColumnId?: string | null;

  @ApiProperty({ required: false, type: () => TaskViewMetaDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TaskViewMetaDto)
  viewMeta?: TaskViewMetaDto;
}

export class BulkUpdateTasksDto {
  @ApiProperty({ type: () => [BulkTaskUpdateItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkTaskUpdateItemDto)
  items: BulkTaskUpdateItemDto[];
}

export { BulkTaskUpdateItemDto };
