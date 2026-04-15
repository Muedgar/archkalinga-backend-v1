import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';

export class UserSearchDto {
  @ApiProperty({
    description:
      'Search term matched against first name, last name, full name, username, email, and workspace name/slug. Minimum 2 characters.',
    example: 'jane',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({
    description:
      'When provided, filters out users who are already active members of this project.',
    example: 'uuid-of-project',
  })
  @IsUUID()
  @IsOptional()
  excludeProjectId?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
