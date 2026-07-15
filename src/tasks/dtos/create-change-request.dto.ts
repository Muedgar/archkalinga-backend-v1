import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ArrayUnique,
  IsArray,
  ValidateIf,
} from 'class-validator';
import { ChangeRequestImpactType, ChangeRequestPriority } from '../entities';

const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' || value === undefined ? null : value;

const optionalNumber = ({ value }: { value: unknown }) => {
  if (value === '' || value === undefined || value === null) return null;
  return Number(value);
};

const optionalUuidArray = ({ value }: { value: unknown }) => {
  if (value === '' || value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

const optionalJsonObject = ({ value }: { value: unknown }) => {
  if (value === '' || value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export class CreateChangeRequestDto {
  @ApiProperty({ example: 'Revise window schedule for level 2' })
  @IsString()
  @Length(1, 255)
  @Type(() => String)
  title: string;

  @ApiPropertyOptional({
    example:
      'The client requested a different window specification after site review.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  description?: string | null;

  @ApiPropertyOptional({
    enum: ChangeRequestImpactType,
    example: ChangeRequestImpactType.SCHEDULE,
    nullable: true,
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ChangeRequestImpactType)
  impactType?: ChangeRequestImpactType | null;

  @ApiPropertyOptional({
    enum: ChangeRequestPriority,
    example: ChangeRequestPriority.HIGH,
    nullable: true,
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(ChangeRequestPriority)
  priority?: ChangeRequestPriority | null;

  @ApiPropertyOptional({
    example: 'Client-requested design change',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Length(1, 100)
  @Type(() => String)
  reasonCategory?: string | null;

  @ApiPropertyOptional({ example: 250000, nullable: true })
  @IsOptional()
  @Transform(optionalNumber)
  @IsNumber()
  @Min(0)
  @Max(999999999999.99)
  costImpactAmount?: number | null;

  @ApiPropertyOptional({ example: 14, nullable: true })
  @IsOptional()
  @Transform(optionalNumber)
  @IsInt()
  @Min(-9999)
  @Max(9999)
  scheduleImpactDays?: number | null;

  @ApiPropertyOptional({ example: '2026-08-15', nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @IsDateString()
  requestedDueDate?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['6cc7f54e-5d31-43c2-9d24-71a85a78b9ea'],
    description:
      'Task document IDs affected by this request. Multipart clients may send a JSON array or comma-separated string.',
  })
  @IsOptional()
  @Transform(optionalUuidArray)
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  affectedDocumentIds?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: {
      title: {
        from: 'Install level 2 windows',
        to: 'Install revised level 2 windows',
      },
      endDate: {
        from: '2026-08-01',
        to: '2026-08-15',
      },
    },
    description:
      'Structured proposed task-field changes. Multipart clients may send this as a JSON object string.',
  })
  @IsOptional()
  @Transform(optionalJsonObject)
  @IsObject()
  proposedTaskChanges?: Record<string, unknown> | null;

  @ApiProperty({
    example:
      'Please review this change before I proceed with the updated drawings.',
    description:
      'Initial thread message. Required unless the request includes an uploaded attachment.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  message?: string;

  @ApiPropertyOptional({
    example: 'Client markups from the site meeting.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;
}
