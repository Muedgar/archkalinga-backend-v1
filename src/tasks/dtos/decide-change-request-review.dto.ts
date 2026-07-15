import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { ChangeRequestReviewStatus } from '../entities';

export const CHANGE_REQUEST_REVIEW_DECISIONS = [
  ChangeRequestReviewStatus.APPROVED,
  ChangeRequestReviewStatus.REJECTED,
  ChangeRequestReviewStatus.RETURNED_FOR_REVISION,
] as const;

export type ChangeRequestReviewDecision =
  (typeof CHANGE_REQUEST_REVIEW_DECISIONS)[number];

export class DecideChangeRequestReviewDto {
  @ApiProperty({
    enum: CHANGE_REQUEST_REVIEW_DECISIONS,
    example: ChangeRequestReviewStatus.APPROVED,
  })
  @IsEnum(CHANGE_REQUEST_REVIEW_DECISIONS)
  decision: ChangeRequestReviewDecision;

  @ApiPropertyOptional({
    example: 'Cost impact is acceptable with the attached estimate.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  decisionNotes?: string | null;
}
