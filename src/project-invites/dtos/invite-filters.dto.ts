import { IsEnum, IsOptional, IsUUID, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InviteStatus } from 'src/projects/entities/project-invite.entity';

export class InviteFiltersDto {
  @ApiPropertyOptional({ description: 'Filter by task UUID' })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({ description: 'Filter by subtask UUID' })
  @IsOptional()
  @IsUUID()
  subtaskId?: string;

  @ApiPropertyOptional({
    enum: InviteStatus,
    description: 'Filter by invite status',
  })
  @IsOptional()
  @IsEnum(InviteStatus)
  status?: InviteStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 50;
}
