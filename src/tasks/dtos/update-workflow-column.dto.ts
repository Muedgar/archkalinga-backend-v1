import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateWorkflowColumnDto {
  @ApiPropertyOptional({ example: 'Review' })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Type(() => String)
  name?: string;

  @ApiPropertyOptional({ example: 'IN_REVIEW' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  @Type(() => String)
  statusKey?: string | null;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional({ example: 3, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  wipLimit?: number | null;
}
