import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';

import { GetUser } from 'src/auth/decorators';
import { JwtAuthGuard } from 'src/auth/guards';
import { ResponseMessage } from 'src/common/decorators';
import type { User } from 'src/users/entities';
import type { RequestUser } from 'src/auth/types';

import { UpdateWorkspaceSettingsDto } from './dtos';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceMemberSerializer } from './serializers/workspace-member.serializer';

@ApiTags('Workspaces')
@Controller('workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  // ── GET /workspaces/me ───────────────────────────────────────────────────────
  //
  // Returns all workspaces the authenticated user is an active member of,
  // with their role and permissions for each workspace.

  @Get('me')
  @ResponseMessage('Workspaces fetched')
  @ApiOperation({
    summary: "List the authenticated user's workspaces",
    description:
      'Returns all active workspace memberships for the current user, each with the ' +
      "workspace details and the user's role + permission matrix for that workspace. " +
      'The first item is the earliest-joined workspace. Use this to build a workspace ' +
      'switcher or to resolve the initial active workspace after login.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of WorkspaceMember objects (with workspace and workspaceRole relations)',
  })
  async getMyWorkspaces(@GetUser() user: User) {
    const memberships = await this.workspacesService.getMembershipsWithWorkspace(user.id);
    return memberships.map((m) =>
      plainToInstance(WorkspaceMemberSerializer, m, { excludeExtraneousValues: true }),
    );
  }

  // ── GET /workspaces/:workspaceId/membership/me ────────────────────────────────
  //
  // Returns the authenticated user's membership for a specific workspace,
  // including their role and full permission matrix.

  @Get(':workspaceId/membership/me')
  @ResponseMessage('Workspace membership fetched')
  @ApiOperation({
    summary: "Get the user's membership for a specific workspace",
    description:
      "Returns the current user's WorkspaceMember record for the given workspace, " +
      'including the workspace details and their role + permission matrix. ' +
      'Use this after switching workspace to load the new permission context, or ' +
      'during app bootstrap when restoring a saved workspaceId from storage. ' +
      'Returns 404 if the user is not an active member of the workspace.',
  })
  @ApiResponse({
    status: 200,
    description: 'WorkspaceMember with workspace and workspaceRole relations',
  })
  @ApiResponse({
    status: 404,
    description: 'Not a member of this workspace or workspace does not exist',
  })
  async getMyMembership(
    @GetUser() user: User,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    const member = await this.workspacesService.getMyMembership(user.id, workspaceId);
    return plainToInstance(WorkspaceMemberSerializer, member, {
      excludeExtraneousValues: true,
    });
  }

  // ── PATCH /workspaces/:workspaceId/settings ──────────────────────────────────
  //
  // Updates workspace-level settings: name, description, allowPublicProfiles.
  // Authorization is enforced in the service — caller must have
  // userManagement.update permission in this workspace.

  @Patch(':workspaceId/settings')
  @ResponseMessage('Workspace settings updated')
  @ApiOperation({
    summary: 'Update workspace settings (admin only)',
    description:
      'Updates workspace-level settings including name, description, and the ' +
      'allowPublicProfiles discoverability flag. Only callable by workspace members ' +
      "whose role grants userManagement.update permission.",
  })
  @ApiResponse({ status: 200, description: 'Updated workspace object' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Workspace not found or not a member' })
  updateSettings(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @GetUser() requestUser: RequestUser,
    @Body() dto: UpdateWorkspaceSettingsDto,
  ) {
    return this.workspacesService.updateSettings(workspaceId, requestUser.id, dto);
  }
}
