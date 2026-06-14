import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScheduleType } from '../entities';
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

  @ApiProperty({ required: false, enum: ScheduleType })
  @IsOptional()
  @IsEnum(ScheduleType)
  scheduleType?: ScheduleType;

  @ApiProperty({ required: false, nullable: true, example: '2.2.3.4' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  wbsCode?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '0002.0002.0003.0004',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Type(() => String)
  wbsSortKey?: string | null;

  @ApiProperty({ required: false, nullable: true, example: 25 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  weightPercent?: number | null;

  @ApiProperty({ required: false, example: false })
  @IsOptional()
  @IsBoolean()
  isManuallyScheduled?: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'Pinned to match client-approved site access window.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Type(() => String)
  manualScheduleReason?: string | null;

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
