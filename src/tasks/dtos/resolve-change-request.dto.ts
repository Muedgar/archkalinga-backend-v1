import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { ChangeRequestStatus } from '../entities';

export const CHANGE_REQUEST_DECISION_STATUSES = [
  ChangeRequestStatus.APPROVED,
  ChangeRequestStatus.REJECTED,
  ChangeRequestStatus.RETURNED_FOR_REVISION,
  ChangeRequestStatus.CANCELLED,
] as const;

export type ChangeRequestDecisionStatus =
  (typeof CHANGE_REQUEST_DECISION_STATUSES)[number];

export class ResolveChangeRequestDto {
  @ApiProperty({
    enum: CHANGE_REQUEST_DECISION_STATUSES,
    example: ChangeRequestStatus.APPROVED,
    description:
      'Final decision for the change request. Defaults to APPROVED for backwards-compatible clients.',
  })
  @IsOptional()
  @IsEnum(CHANGE_REQUEST_DECISION_STATUSES)
  decision?: ChangeRequestDecisionStatus;

  @ApiProperty({
    example:
      'Approved. Proceed with the revised specification and update the deliverable.',
  })
  @IsString()
  @Length(1, 4000)
  @Type(() => String)
  resolution: string;

  @ApiPropertyOptional({
    example: 'Final approval note.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @Length(1, 2000)
  @Type(() => String)
  attachmentNotes?: string | null;
}
