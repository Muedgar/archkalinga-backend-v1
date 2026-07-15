import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class ReopenChangeRequestDto {
  @ApiProperty({
    example:
      'Reopening because the client supplied new information after the decision.',
  })
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  reason: string;
}
