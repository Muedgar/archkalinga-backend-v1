import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Body for PATCH /projects/:projectId/members/:memberId/role */
export class UpdateProjectMemberRoleDto {
  @ApiProperty({ description: 'UUID of the project role to assign to the member' })
  @IsUUID('4')
  projectRoleId: string;
}
