import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';
import { TaskDocumentType } from '../entities';

export class TaskDocumentFiltersDto extends ListFilterDTO {
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
