import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';
import { ChangeRequestStatus } from '../entities';

export class ChangeRequestFiltersDto extends ListFilterDTO {
  @ApiPropertyOptional({ enum: ChangeRequestStatus })
  @IsOptional()
  @IsEnum(ChangeRequestStatus)
  status?: ChangeRequestStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  escalatedToUserId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Include the thread messages in list responses.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeMessages?: boolean;
}
