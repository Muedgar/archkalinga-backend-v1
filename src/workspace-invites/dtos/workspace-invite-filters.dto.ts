import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { WorkspaceInviteStatus } from 'src/workspaces/entities/workspace-invite.entity';

export class WorkspaceInviteFiltersDto {
  @ApiPropertyOptional({
    enum: WorkspaceInviteStatus,
    description: 'Filter by invite status',
  })
  @IsOptional()
  @IsEnum(WorkspaceInviteStatus)
  status?: WorkspaceInviteStatus;

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
