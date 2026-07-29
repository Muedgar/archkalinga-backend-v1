import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsObject,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ViewType } from '../entities';

export class BulkTaskViewMetadataItemDto {
  @ApiProperty({ example: 'a7c9ecdb-2d62-4c99-88dd-80f086b47e1e' })
  @IsUUID()
  taskId: string;

  @ApiProperty({
    example: { x: 120, y: 300, collapsed: false },
    description:
      'Layout metadata for the selected view only. This is non-authoritative display state.',
  })
  @IsObject()
  meta: Record<string, unknown>;
}

export class BulkTaskViewMetadataDto {
  @ApiProperty({ enum: ViewType, example: ViewType.MINDMAP })
  @IsEnum(ViewType)
  viewType: ViewType;

  @ApiProperty({ type: () => [BulkTaskViewMetadataItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkTaskViewMetadataItemDto)
  items: BulkTaskViewMetadataItemDto[];
}
