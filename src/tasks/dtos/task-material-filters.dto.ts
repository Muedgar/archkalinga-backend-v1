import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';

export class TaskMaterialFiltersDto extends ListFilterDTO {
  @ApiPropertyOptional({
    example: '7fdff8c1-9da2-43e8-bf08-875b9278fc35',
    description: 'Filter materials for one task UUID.',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  phaseCode?: string;

  @ApiPropertyOptional({ example: '1.1' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  stageCode?: string;

  @ApiPropertyOptional({ example: '1.1.1' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  activityCode?: string;

  @ApiPropertyOptional({ example: '1.1.1.3' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  taskCode?: string;

  @ApiPropertyOptional({ example: 'Miscellaneous' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  materialCategory?: string;

  @ApiPropertyOptional({ example: 'Timber' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  materialName?: string;

  @ApiPropertyOptional({ example: 'OK' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Type(() => String)
  lookupStatus?: string;
}
