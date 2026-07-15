import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';

export class SubmitChangeRequestRevisionDto {
  @ApiPropertyOptional({
    example:
      'I updated the specification and attached the revised markups for review.',
    description:
      'Revision note. Required unless the revision includes an uploaded attachment.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  message?: string;

  @ApiPropertyOptional({
    example: 'Revised markup after reviewer comments.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;
}
