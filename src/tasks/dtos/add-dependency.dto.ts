import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { DependencyType } from '../entities';

export class AddDependencyDto {
  @ApiProperty()
  @IsUUID()
  dependsOnTaskId: string;

  @ApiPropertyOptional({
    enum: DependencyType,
    example: DependencyType.FINISH_TO_START,
  })
  @IsOptional()
  @IsEnum(DependencyType)
  dependencyType?: DependencyType;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  lagDays?: number;
}
