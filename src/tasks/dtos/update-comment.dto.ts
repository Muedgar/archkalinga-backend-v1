import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateCommentDto {
  @ApiPropertyOptional({ example: 'Updated comment body' })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  @Type(() => String)
  body?: string;
}
