import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class ResolveChangeRequestDto {
  @ApiProperty({
    example:
      'Approved. Proceed with the revised specification and update the deliverable.',
  })
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  resolution: string;

  @ApiPropertyOptional({
    example: 'Final approval note.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;
}
