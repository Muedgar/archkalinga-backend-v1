import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body for POST /projects/:projectId/members/assign */
export class AssignProjectMemberDto {
  @ApiProperty({
    description:
      'UUID of the user to assign to the project. The user must already have an account.',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description:
      'Project role UUID to assign. The role controls project-level task visibility via taskManagement.viewScope.',
  })
  @IsUUID()
  projectRoleId: string;

  @ApiPropertyOptional({
    description:
      'Optional message shown if this assignment creates or updates a pending project invite.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
