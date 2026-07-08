import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateChangeRequestMessageDto {
  @ApiPropertyOptional({
    example: 'I have attached the latest marked-up drawing for review.',
    description:
      'Thread message body. Required unless the message includes an uploaded attachment.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  body?: string;

  @ApiPropertyOptional({
    example: 'Updated markup shared by the consultant.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;
}
