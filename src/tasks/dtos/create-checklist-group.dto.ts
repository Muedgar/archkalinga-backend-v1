import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateChecklistGroupDto {
  @ApiProperty({ example: 'Definition of Done' })
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  title: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}
