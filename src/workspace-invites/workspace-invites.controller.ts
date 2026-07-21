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
import { GetUser, RequirePermission } from 'src/auth/decorators';
import { JwtAuthGuard, PermissionGuard } from 'src/auth/guards';
import type { RequestUser } from 'src/auth/types';
import { LogActivity, ResponseMessage } from 'src/common/decorators';
import { WorkspaceInviteStatus } from 'src/workspaces/entities';
import { WorkspaceGuard } from 'src/workspaces/guards/workspace.guard';

import { CreateWorkspaceInviteDto, WorkspaceInviteFiltersDto } from './dtos';
import {
  RECEIVED_WORKSPACE_INVITES_FETCHED,
  WORKSPACE_INVITE_ACCEPTED,
  WORKSPACE_INVITE_CANCELED,
  WORKSPACE_INVITE_CREATED,
  WORKSPACE_INVITE_DECLINED,
  WORKSPACE_INVITE_RESENT,
  WORKSPACE_INVITES_FETCHED,
} from './messages';
import { WorkspaceInvitesService } from './workspace-invites.service';

@ApiTags('Workspace Invites')
@Controller()
export class WorkspaceInvitesController {
  constructor(private readonly invitesService: WorkspaceInvitesService) {}

  // ── POST /workspace-invites ────────────────────────────────────────────────

  @Post('workspace-invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('userManagement', 'create')
  @ResponseMessage(WORKSPACE_INVITE_CREATED)
  @LogActivity({
    action: 'create:workspace-invite',
    resource: 'workspace-invite',
    includeBody: true,
  })
  @ApiOperation({ summary: 'Send a workspace invite' })
  @ApiResponse({ status: 201, description: 'Workspace invite created' })
  @ApiResponse({ status: 409, description: 'Duplicate invite or already a member' })
  createInvite(
    @Body() dto: CreateWorkspaceInviteDto,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.createInvite(dto, user);
  }

  // ── GET /workspace-invites/received ───────────────────────────────────────
  //
  // Static segment MUST come before any :inviteId routes to avoid NestJS
  // treating the literal string "received" as an inviteId.

  @Get('workspace-invites/received')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage(RECEIVED_WORKSPACE_INVITES_FETCHED)
  @ApiOperation({
    summary: 'Workspace invite inbox for the current user',
    description:
      'Returns workspace invites where the authenticated user is the invitee. ' +
      'Use status=PENDING for the invite inbox/action list. After accepting an invite, ' +
      'refresh GET /workspaces/me and switch to the accepted workspace if desired.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: WorkspaceInviteStatus,
    example: WorkspaceInviteStatus.PENDING,
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated received workspace invite list' })
  listReceivedInvites(
    @GetUser() user: RequestUser,
    @Query() filters: WorkspaceInviteFiltersDto,
  ) {
    return this.invitesService.listReceivedInvites(user, filters);
  }

  // ── GET /workspaces/:workspaceId/invites ───────────────────────────────────

  @Get('workspaces/:workspaceId/invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('userManagement', 'create')
  @ResponseMessage(WORKSPACE_INVITES_FETCHED)
  @ApiOperation({ summary: 'List sent invites for a workspace' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated workspace invite list' })
  listInvites(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() filters: WorkspaceInviteFiltersDto,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.listInvites(workspaceId, filters, user);
  }

  // ── POST /workspace-invites/:inviteId/resend ──────────────────────────────

  @Post('workspace-invites/:inviteId/resend')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('userManagement', 'create')
  @ResponseMessage(WORKSPACE_INVITE_RESENT)
  @LogActivity({ action: 'resend:workspace-invite', resource: 'workspace-invite' })
  @ApiOperation({ summary: 'Resend a pending workspace invite' })
  @ApiResponse({ status: 200, description: 'New token generated, expiry extended' })
  @ApiResponse({ status: 400, description: 'Invite is not PENDING' })
  resendInvite(
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.resendInvite(inviteId, user);
  }

  // ── POST /workspace-invites/:inviteId/cancel ──────────────────────────────

  @Post('workspace-invites/:inviteId/cancel')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('userManagement', 'create')
  @ResponseMessage(WORKSPACE_INVITE_CANCELED)
  @LogActivity({ action: 'cancel:workspace-invite', resource: 'workspace-invite' })
  @ApiOperation({ summary: 'Cancel a pending workspace invite' })
  @ApiResponse({ status: 200, description: 'Invite revoked' })
  @ApiResponse({ status: 400, description: 'Invite is not PENDING' })
  cancelInvite(
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.cancelInvite(inviteId, user);
  }

  // ── POST /workspace-invites/:inviteId/accept ──────────────────────────────

  @Post('workspace-invites/:inviteId/accept')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage(WORKSPACE_INVITE_ACCEPTED)
  @LogActivity({ action: 'accept:workspace-invite', resource: 'workspace-invite' })
  @ApiOperation({
    summary: 'Accept a received workspace invite',
    description:
      'The authenticated user must be the invitee. ' +
      'Creates/reactivates workspace membership and assigns the selected workspace role. ' +
      'Frontend should refresh GET /workspaces/me after success.',
  })
  @ApiResponse({ status: 200, description: 'Invite accepted — returns membership context' })
  @ApiResponse({ status: 400, description: 'Invite not PENDING or expired' })
  @ApiResponse({ status: 403, description: 'Invite was not sent to this user' })
  acceptInviteById(
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.acceptInviteById(inviteId, user);
  }

  // ── POST /workspace-invites/:inviteId/decline ─────────────────────────────

  @Post('workspace-invites/:inviteId/decline')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage(WORKSPACE_INVITE_DECLINED)
  @LogActivity({ action: 'decline:workspace-invite', resource: 'workspace-invite' })
  @ApiOperation({
    summary: 'Decline a received workspace invite',
    description:
      'The authenticated user must be the invitee. ' +
      'Sets status to DECLINED and notifies the inviter.',
  })
  @ApiResponse({ status: 200, description: '{ id, declined: true }' })
  @ApiResponse({ status: 400, description: 'Invite not PENDING' })
  @ApiResponse({ status: 403, description: 'Invite was not sent to this user' })
  declineInvite(
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.declineInvite(inviteId, user);
  }

  // ── POST /workspace-invites/accept (token-based email-link flow) ───────────

  @Post('workspace-invites/accept')
  @ResponseMessage(WORKSPACE_INVITE_ACCEPTED)
  @ApiOperation({
    summary: 'Accept a workspace invite by one-time token',
  })
  @ApiQuery({ name: 'token', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Workspace invite accepted' })
  @ApiResponse({ status: 400, description: 'Token invalid or expired' })
  acceptInviteByToken(@Query('token') token: string) {
    return this.invitesService.acceptInvite(token);
  }
}
