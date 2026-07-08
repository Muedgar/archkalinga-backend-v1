import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateChangeRequestDto {
  @ApiProperty({ example: 'Revise window schedule for level 2' })
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  title: string;

  @ApiPropertyOptional({
    example:
      'The client requested a different window specification after site review.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  description?: string | null;

  @ApiProperty({
    example:
      'Please review this change before I proceed with the updated drawings.',
    description:
      'Initial thread message. Required unless the request includes an uploaded attachment.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  message?: string;

  @ApiPropertyOptional({
    example: 'Client markups from the site meeting.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;
}
