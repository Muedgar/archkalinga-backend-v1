import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class EscalateChangeRequestDto {
  @ApiProperty({
    example:
      'This change affects the parent task scope and needs higher-level review.',
  })
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  message: string;

  @ApiPropertyOptional({
    example: 'Supporting cost/scope note for escalation.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;
}
