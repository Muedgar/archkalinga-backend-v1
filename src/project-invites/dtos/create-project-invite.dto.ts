import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateProjectInviteDto {
  @ApiProperty({ description: 'Target project UUID' })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description:
      'UUID of the user to invite. The user must already have an account — ' +
      'find them via GET /users/search before sending the invite.',
  })
  @IsUUID()
  inviteeUserId: string;

  @ApiProperty({ description: 'Project role UUID the invitee will receive on acceptance' })
  @IsUUID()
  projectRoleId: string;

  @ApiPropertyOptional({ description: 'Optional personal message shown to the invitee' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
