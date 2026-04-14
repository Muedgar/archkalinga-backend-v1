import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectInviteDto {
  @ApiProperty({ description: 'Target project UUID' })
  @IsUUID()
  projectId: string;

  @ApiProperty({ description: 'Invitee email address' })
  @IsEmail()
  inviteeEmail: string;

  @ApiProperty({
    description: 'Project role UUID the invitee will receive on acceptance',
  })
  @IsUUID()
  projectRoleId: string;

  // ── Task context (optional) ────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Task UUID that triggered this invite' })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  /**
   * Subtask UUID. Only valid when taskId is also provided.
   * A subtask invite records both taskId (parent) and subtaskId (child).
   */
  @ApiPropertyOptional({ description: 'Subtask UUID (requires taskId)' })
  @ValidateIf((o: CreateProjectInviteDto) => !!o.subtaskId)
  @IsUUID()
  subtaskId?: string;

  // ── Optional extras ────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    description: 'Personal message shown in the invite email/UI',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  /**
   * When true, accepted invitees are automatically added as CONTRIBUTOR
   * to the referenced task or subtask.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  autoAssignOnAccept?: boolean;
}
