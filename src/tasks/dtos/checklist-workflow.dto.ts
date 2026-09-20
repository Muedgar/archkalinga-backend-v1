import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { WorkflowIntent } from '../workflow/checklist-policy';
export class WorkflowRevisionDto {
  @ApiProperty() @IsInt() @Min(1) expectedRevision: number;
  @ApiProperty() @IsString() @Length(1, 128) idempotencyKey: string;
}
export class SubmitChecklistDto extends WorkflowRevisionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  submissionNote?: string;
}
export class DecideChecklistDto extends WorkflowRevisionDto {
  @ApiProperty({ enum: ['ACCEPT', 'REJECT', 'WITHDRAW'] })
  @IsIn(['ACCEPT', 'REJECT', 'WITHDRAW'])
  decision: WorkflowIntent;
  @ApiPropertyOptional() @IsOptional() @IsUUID() statusId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  reviewNote?: string;
}
export class ChecklistReviewNoteDto extends WorkflowRevisionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() noteId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedNoteRevision?: number;
  @ApiProperty() @IsString() @Length(1, 4000) text: string;
}
export class SubmissionHistoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeAttempt?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
