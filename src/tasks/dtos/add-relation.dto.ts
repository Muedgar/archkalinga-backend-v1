import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { RelationType } from '../entities/task-relation.entity';

export class AddRelationDto {
  @ApiProperty({ example: 'a1b2c3d4-...', description: 'Related task UUID' })
  @IsUUID()
  relatedTaskId: string;

  @ApiPropertyOptional({
    enum: RelationType,
    default: RelationType.RELATES_TO,
    description: 'RELATES_TO | BLOCKS | DUPLICATES | CLONES',
  })
  @IsOptional()
  @IsEnum(RelationType)
  relationType?: RelationType;
}
