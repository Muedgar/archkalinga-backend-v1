import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class AddChecklistItemDto {
  @ApiProperty({ example: 'Upload base survey' })
  @IsString()
  @Length(1, 500)
  @Type(() => String)
  text: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-...',
    description: 'Checklist group UUID to assign this item to',
  })
  @IsOptional()
  @IsUUID()
  checklistGroupId?: string | null;
}
