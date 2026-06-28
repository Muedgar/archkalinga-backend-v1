import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateStarterFromDeliverableDto {
  @ApiProperty({
    example: '7fdff8c1-9da2-43e8-bf08-875b9278fc35',
    description: 'Task that owns the source DELIVERABLE document.',
  })
  @IsUUID()
  sourceTaskId: string;

  @ApiProperty({
    example: '5d97f20b-3ef6-476a-a48b-a7d8fc172d5f',
    description: 'Existing DELIVERABLE document to link as a STARTER input.',
  })
  @IsUUID()
  sourceDocumentId: string;

  @ApiPropertyOptional({
    example: 'Survey package starter copy',
    description:
      'Optional target STARTER document name. Defaults to the source document name.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  name?: string;

  @ApiPropertyOptional({
    example: 'Starter input created from the approved survey deliverable.',
    description:
      'Optional target STARTER document description. Defaults to the source document description.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  description?: string | null;

  @ApiPropertyOptional({
    example: 'Linked from upstream deliverable.',
    description:
      'Optional notes for the target active attachment. Defaults to the source attachment notes.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;
}
