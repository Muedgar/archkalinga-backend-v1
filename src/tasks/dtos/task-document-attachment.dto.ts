import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class TaskDocumentAttachmentDto {
  @ApiProperty({ example: 'site-plan-v1.pdf' })
  @IsString()
  @Length(1, 500)
  @Type(() => String)
  filename: string;

  @ApiProperty({ example: 'task-documents' })
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  bucketName: string;

  @ApiPropertyOptional({
    example: 'Initial upload from document register',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  notes?: string | null;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
