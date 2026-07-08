import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TaskDocumentType } from '../entities';
import { TaskDocumentAttachmentDto } from './task-document-attachment.dto';

export class CreateTaskDocumentDto {
  @ApiProperty({ example: 'Site survey starter pack' })
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  name: string;

  @ApiPropertyOptional({
    example:
      'Input documents required before construction documentation starts.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  description?: string | null;

  @ApiProperty({ enum: TaskDocumentType, example: TaskDocumentType.STARTER })
  @IsEnum(TaskDocumentType)
  type: TaskDocumentType;

  @ApiPropertyOptional({
    example: 'task-documents',
    description:
      'Optional MinIO bucket override for uploaded file storage. Defaults to TASK_DOCUMENTS_BUCKET or task-documents.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 63)
  @Type(() => String)
  bucketName?: string;

  @ApiPropertyOptional({
    example: 'Signed site survey received from the consultant.',
    description: 'Notes attached to the uploaded active file.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;

  @ApiPropertyOptional({ type: [TaskDocumentAttachmentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskDocumentAttachmentDto)
  attachments?: TaskDocumentAttachmentDto[];
}
