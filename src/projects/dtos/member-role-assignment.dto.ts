import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class MemberRoleAssignmentDto {
  @ApiProperty({ example: 'uuid-of-user' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({
    example: 'uuid-of-project-role',
    description:
      'Optional project role UUID for this member. When omitted, the default Contributor role is used.',
  })
  @IsUUID()
  @IsOptional()
  projectRoleId?: string;
}

export class UpdateProjectMemberRoleDto {
  @ApiProperty({ example: 'uuid-of-project-role' })
  @IsUUID()
  projectRoleId: string;
}
