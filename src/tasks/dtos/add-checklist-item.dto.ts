import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class AddChecklistItemDto {
  @ApiProperty({ example: 'Upload base survey' })
  @IsString()
  @Length(1, 500)
  @Type(() => String)
  text: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  orderIndex: number;
}
