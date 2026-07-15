import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ListFilterDTO } from 'src/common/dtos';
import {
  ChangeRequestImpactType,
  ChangeRequestPriority,
  ChangeRequestStatus,
} from '../entities';

export class ChangeRequestFiltersDto extends ListFilterDTO {
  @ApiPropertyOptional({ enum: ChangeRequestStatus })
  @IsOptional()
  @IsEnum(ChangeRequestStatus)
  status?: ChangeRequestStatus;

  @ApiPropertyOptional({ enum: ChangeRequestImpactType })
  @IsOptional()
  @IsEnum(ChangeRequestImpactType)
  impactType?: ChangeRequestImpactType;

  @ApiPropertyOptional({ enum: ChangeRequestPriority })
  @IsOptional()
  @IsEnum(ChangeRequestPriority)
  priority?: ChangeRequestPriority;

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

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  reviewerUserId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter to change requests linked to this task document.',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter requests that have at least one linked task document.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  hasAffectedDocuments?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Filter requests that include structured proposed task changes.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  hasProposedTaskChanges?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Filter requests that need action from the current user, such as a pending review or returned revision.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  needsMyAttention?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Include dashboard summary counters in the list response.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeSummary?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Include the thread messages in list responses.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeMessages?: boolean;
}
