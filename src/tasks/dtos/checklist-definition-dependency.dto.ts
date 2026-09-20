import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID } from 'class-validator';
import { DependencyType } from '../entities/task-dependency.entity';
export class ChecklistDefinitionDependencyDto {
  @ApiProperty() @IsUUID() dependsOnChecklistItemId: string;
  @ApiPropertyOptional({ enum: ['FS', 'SS', 'FF', 'SF'] })
  @IsOptional()
  @IsIn(['FS', 'SS', 'FF', 'SF'])
  dependencyType?: DependencyType;
  @ApiPropertyOptional() @IsOptional() @IsInt() lagDays?: number;
}
