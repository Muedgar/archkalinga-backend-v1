import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetUser, RequireProjectPermission } from 'src/auth/decorators';
import { JwtAuthGuard, ProjectPermissionGuard } from 'src/auth/guards';
import type { RequestUser } from 'src/auth/types';
import { LogActivity, ResponseMessage } from 'src/common/decorators';

import { CreateProjectInviteDto, InviteFiltersDto } from './dtos';
import {
  INVITE_ACCEPTED,
  INVITE_CANCELED,
  INVITE_CREATED,
  INVITE_RESENT,
  INVITES_FETCHED,
} from './messages';
import { ProjectInvitesService } from './project-invites.service';

@ApiTags('Project Invites')
@Controller()
export class ProjectInvitesController {
  constructor(private readonly invitesService: ProjectInvitesService) {}

  // ── POST /project-invites ──────────────────────────────────────────────────
  //
  // Creates a new project invite with optional task/subtask context.
  // The project is identified inside the DTO body so that the same endpoint
  // works for project-level, task-level, and subtask-level invites.

  @Post('project-invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'update')
  @ResponseMessage(INVITE_CREATED)
  @LogActivity({
    action: 'create:invite',
    resource: 'project-invite',
    includeBody: true,
  })
  @ApiOperation({
    summary: 'Send a project invite (optionally from a task or subtask)',
    description:
      'Creates a pending invite for the given email. If taskId is provided the invite ' +
      'carries task context; additionally providing subtaskId records subtask context. ' +
      'The project role must belong to the same project, and the caller must hold projectManagement.update through their active project role.',
  })
  @ApiResponse({ status: 201, description: 'Invite created' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or subtask does not belong to task',
  })
  @ApiResponse({
    status: 409,
    description: 'Duplicate pending invite or invitee already a member',
  })
  createInvite(
    @Body() dto: CreateProjectInviteDto,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.createInvite(dto, user);
  }

  // ── GET /projects/:projectId/invites ───────────────────────────────────────

  @Get('projects/:projectId/invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'view')
  @ResponseMessage(INVITES_FETCHED)
  @ApiOperation({
    summary: 'List invites for a project',
    description:
      'Returns all invites for the project. Use taskId/subtaskId query params to ' +
      "scope the list to a specific work item (for task/subtask detail panels). Requires projectManagement.view through the caller's active project role.",
  })
  @ApiQuery({ name: 'taskId', required: false, type: String })
  @ApiQuery({ name: 'subtaskId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated invite list' })
  listInvites(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() filters: InviteFiltersDto,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.listInvites(projectId, filters, user);
  }

  // ── POST /project-invites/:inviteId/resend ────────────────────────────────

  @Post('project-invites/:inviteId/resend')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'update')
  @ResponseMessage(INVITE_RESENT)
  @LogActivity({ action: 'resend:invite', resource: 'project-invite' })
  @ApiOperation({
    summary: 'Resend a pending invite',
    description:
      'Generates a fresh token and extends the expiry by 7 days. ' +
      'Only PENDING invites can be resent, and the caller must hold projectManagement.update through their active project role.',
  })
  @ApiResponse({
    status: 200,
    description: 'New token generated and expiry extended',
  })
  @ApiResponse({ status: 400, description: 'Invite is not in PENDING status' })
  @ApiResponse({ status: 404, description: 'Invite not found' })
  resendInvite(
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.resendInvite(inviteId, user);
  }

  // ── POST /project-invites/:inviteId/cancel ────────────────────────────────

  @Post('project-invites/:inviteId/cancel')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'update')
  @ResponseMessage(INVITE_CANCELED)
  @LogActivity({ action: 'cancel:invite', resource: 'project-invite' })
  @ApiOperation({
    summary: 'Cancel a pending invite',
    description:
      'Sets the invite status to REVOKED. Only PENDING invites can be canceled, and the caller must hold projectManagement.update through their active project role.',
  })
  @ApiResponse({ status: 200, description: 'Invite revoked' })
  @ApiResponse({ status: 400, description: 'Invite is not in PENDING status' })
  @ApiResponse({ status: 404, description: 'Invite not found' })
  cancelInvite(
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.cancelInvite(inviteId, user);
  }

  // ── POST /project-invites/accept ─────────────────────────────────────────
  //
  // Token-based acceptance — does not require authentication.
  // The frontend exchanges the token after the user registers/logs in.

  @Post('project-invites/accept')
  @ResponseMessage(INVITE_ACCEPTED)
  @ApiOperation({
    summary: 'Accept an invite by token',
    description:
      'Validates the one-time token, creates or reactivates the project membership, assigns the invited project role to that membership, optionally auto-assigns the user to the referenced task/subtask, and returns redirect context plus the granted membership role.',
  })
  @ApiQuery({ name: 'token', required: true, type: String })
  @ApiResponse({
    status: 200,
    description:
      'Invite accepted — returns { inviteId, projectId, taskId, subtaskId, membership { id, status, projectRoleId, projectRole } }',
  })
  @ApiResponse({
    status: 400,
    description: 'Token invalid, expired, or account not found',
  })
  acceptInvite(@Query('token') token: string) {
    return this.invitesService.acceptInvite(token);
  }
}
