import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class AddCommentDto {
  @ApiProperty({ example: 'Please include the revised drawing set.' })
  @IsString()
  @Length(1, 5000)
  @Type(() => String)
  body: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentCommentId?: string;
}
