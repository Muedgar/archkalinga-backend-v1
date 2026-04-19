import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TaskViewMetaDto } from './create-task.dto';

class BulkTaskUpdateItemDto {
  @ApiProperty()
  @IsUUID()
  taskId: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  statusId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  priorityId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  taskTypeId?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  severityId?: string | null;

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
