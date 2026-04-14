import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateWorkflowColumnDto {
  @ApiProperty({ example: 'In Progress' })
  @IsString()
  @Length(2, 200)
  @Type(() => String)
  name: string;

  @ApiPropertyOptional({ example: 'IN_PROGRESS' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  @Type(() => String)
  statusKey?: string | null;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  wipLimit?: number | null;
}
