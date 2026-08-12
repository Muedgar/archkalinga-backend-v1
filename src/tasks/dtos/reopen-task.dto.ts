import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class ReopenTaskDto {
  @ApiPropertyOptional({
    description:
      'Non-Done status to move the task into. Defaults to the project default active non-Done status.',
  })
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({
    example: 80,
    description:
      'Optional progress to set while reopening. Parent progress remains rollup-derived.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ example: 'Additional field work required' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Type(() => String)
  reason?: string;
}
