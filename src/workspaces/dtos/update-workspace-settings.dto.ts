import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Workspace-level settings that workspace admins can update.
 * Structural fields (slug) are intentionally excluded.
 */
export class UpdateWorkspaceSettingsDto {
  @ApiPropertyOptional({ description: 'Display name for the workspace' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'Short description of the workspace' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'When true, ALL active members of this workspace become discoverable in ' +
      'GET /users/search — regardless of each member\'s individual isPublicProfile setting.',
  })
  @IsOptional()
  @IsBoolean()
  allowPublicProfiles?: boolean;
}
