import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateTaskLocationItemDto {
  @ApiPropertyOptional({ example: 'APT-401' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  locationCode?: string | null;

  @ApiProperty({ example: 'Apartment 401' })
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  locationName: string;

  @ApiPropertyOptional({ example: 'East wing, level 4' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Type(() => String)
  description?: string | null;

  @ApiPropertyOptional({ example: 1, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedQuantity?: number | null;

  @ApiPropertyOptional({ example: 'apartment', nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Type(() => String)
  unit?: string | null;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

export class CreateTaskLocationsDto {
  @ApiProperty({ type: () => [CreateTaskLocationItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskLocationItemDto)
  locations: CreateTaskLocationItemDto[];
}
