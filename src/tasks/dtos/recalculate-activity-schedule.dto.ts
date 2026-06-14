import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RecalculateActivityScheduleDto {
  @ApiPropertyOptional({
    example: 'manual',
    description:
      'Reason/source of recalculation, for example manual, dependency_change, duration_change, or calendar_change.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  triggerType?: string;

  @ApiPropertyOptional({
    example: '3d0a318d-d0e8-44ea-b3d7-c8bce1ff847b',
    description: 'Optional task that triggered recalculation.',
  })
  @IsOptional()
  @IsUUID()
  triggerTaskId?: string | null;
}
