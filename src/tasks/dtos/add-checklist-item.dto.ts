import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

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
    description:
      'Project status UUID used for checklist Kanban column placement.',
  })
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({
    example: '0000001000',
    nullable: true,
    description: 'Checklist Kanban rank within the status column.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Type(() => String)
  rank?: string | null;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-...',
    description: 'Checklist group UUID to assign this item to',
  })
  @IsOptional()
  @IsUUID()
  checklistGroupId?: string | null;

  @ApiPropertyOptional({
    example: 'CHK-001',
    description: 'Optional permanent checklist item code within this task.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  itemCode?: string | null;
}
