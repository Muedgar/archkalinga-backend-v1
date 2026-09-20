import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsUUID,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';
import { TaskDocumentType } from '../entities';

export class TaskDocumentFiltersDto extends ListFilterDTO {
  @ApiPropertyOptional({ enum: ['TASK', 'CHECKLIST'] })
  @IsOptional()
  @IsIn(['TASK', 'CHECKLIST'])
  scope?: 'TASK' | 'CHECKLIST';
  @ApiPropertyOptional({
    description: 'Filter documents owned by a checklist item of this task',
  })
  @IsOptional()
  @IsUUID()
  checklistItemId?: string;

  @ApiPropertyOptional({ enum: TaskDocumentType })
  @IsOptional()
  @IsEnum(TaskDocumentType)
  type?: TaskDocumentType;

  @ApiPropertyOptional({ example: 'survey' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  name?: string;
}
