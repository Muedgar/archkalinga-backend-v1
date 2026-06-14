import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { DependencyType } from '../entities';

export class UpdateDependencyDto {
  @ApiPropertyOptional({
    enum: DependencyType,
    example: DependencyType.FINISH_TO_START,
  })
  @IsOptional()
  @IsEnum(DependencyType)
  dependencyType?: DependencyType;

  @ApiPropertyOptional({
    example: -2,
    description: 'Signed lag in days. Positive is wait time; negative is lead.',
  })
  @IsOptional()
  @IsInt()
  lagDays?: number | null;
}
