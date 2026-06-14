import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID } from 'class-validator';
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

  @ApiPropertyOptional({
    example: -2,
    description:
      'Signed lag in days. Positive values wait after the dependency point; 0 means no delay; negative values are lead and shift the successor earlier.',
  })
  @IsOptional()
  @IsInt()
  lagDays?: number;
}
