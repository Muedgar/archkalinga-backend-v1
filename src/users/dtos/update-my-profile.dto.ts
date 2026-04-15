import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Fields the authenticated user can update on their own profile.
 * Admin-only fields (status, roleId, email) are intentionally excluded —
 * those live on PATCH /users/:id (admin route).
 */
export class UpdateMyProfileDto {
  @ApiPropertyOptional({ description: 'First name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ description: 'Display username' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userName?: string;

  @ApiPropertyOptional({ description: 'Job title or role description' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description:
      'When true, this user appears in GET /users/search results for other authenticated users, ' +
      'regardless of the workspace allowPublicProfiles setting.',
  })
  @IsOptional()
  @IsBoolean()
  isPublicProfile?: boolean;
}
