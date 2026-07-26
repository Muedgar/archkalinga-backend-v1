import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class SupersedeTaskDto {
  @ApiProperty({
    example: '3d0a318d-d0e8-44ea-b3d7-c8bce1ff847b',
    description: 'Existing active task that replaces the current task.',
  })
  @IsUUID()
  replacementTaskId: string;

  @ApiPropertyOptional({
    example: 'Corrected scope after site review.',
    description: 'Audit explanation for why this task was superseded.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Type(() => String)
  reason?: string | null;
}
