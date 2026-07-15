import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

export class CreateChangeRequestReviewDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  reviewerUserId: string;

  @ApiPropertyOptional({ example: 'Cost reviewer', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  role?: string | null;

  @ApiPropertyOptional({
    example: 'Please validate budget and procurement impact.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  notes?: string | null;
}
