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
  INVITE_DECLINED,
  INVITE_RESENT,
  INVITES_FETCHED,
  RECEIVED_INVITES_FETCHED,
} from './messages';
import { ProjectInvitesService } from './project-invites.service';

@ApiTags('Project Invites')
@Controller()
export class ProjectInvitesController {
  constructor(private readonly invitesService: ProjectInvitesService) {}

  // ── POST /project-invites ──────────────────────────────────────────────────

  @Post('project-invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ProjectPermissionGuard)
  @RequireProjectPermission('canManageProject')
  @ResponseMessage(INVITE_CREATED)
  @LogActivity({ action: 'create:invite', resource: 'project-invite', includeBody: true })
  @ApiOperation({ summary: 'Send a project invite' })
  @ApiResponse({ status: 201, description: 'Invite created' })
  @ApiResponse({ status: 409, description: 'Duplicate or already a member' })
  createInvite(
    @Body() dto: CreateProjectInviteDto,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.createInvite(dto, user);
  }

  // ── GET /project-invites/received ─────────────────────────────────────────
  //
  // Static segment MUST come before any :inviteId routes to avoid NestJS
  // treating the literal string "received" as an inviteId.

  @Get('project-invites/received')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage(RECEIVED_INVITES_FETCHED)
  @ApiOperation({
    summary: 'List invites received by the current user (invitee perspective)',
    description:
      'Returns invites where the authenticated user is the invitee. ' +
      'Filter by status=PENDING to show only actionable invites.',
  })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated received invite list' })
  listReceivedInvites(
    @GetUser() user: RequestUser,
    @Query() filters: InviteFiltersDto,
  ) {
    return this.invitesService.listReceivedInvites(user, filters);
  }

  // ── GET /projects/:projectId/invites ───────────────────────────────────────

  @Get('projects/:projectId/invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ProjectPermissionGuard)
  @RequireProjectPermission('canManageProject')
  @ResponseMessage(INVITES_FETCHED)
  @ApiOperation({ summary: 'List sent invites for a project (inviter perspective)' })
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
  @RequireProjectPermission('canManageProject')
  @ResponseMessage(INVITE_RESENT)
  @LogActivity({ action: 'resend:invite', resource: 'project-invite' })
  @ApiOperation({ summary: 'Resend a pending invite (generates a fresh token)' })
  @ApiResponse({ status: 200, description: 'New token generated, expiry extended' })
  @ApiResponse({ status: 400, description: 'Invite is not PENDING' })
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
  @RequireProjectPermission('canManageProject')
  @ResponseMessage(INVITE_CANCELED)
  @LogActivity({ action: 'cancel:invite', resource: 'project-invite' })
  @ApiOperation({ summary: 'Cancel (revoke) a pending invite' })
  @ApiResponse({ status: 200, description: 'Invite revoked' })
  @ApiResponse({ status: 400, description: 'Invite is not PENDING' })
  cancelInvite(
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.invitesService.cancelInvite(inviteId, user);
  }

  // ── POST /project-invites/:inviteId/accept (authenticated) ───────────────
  //
  // Accepts an invite by its ID. The JWT user must be the invitee.
  // This is the endpoint used from the notifications page / invite cards.

  @Post('project-invites/:inviteId/accept')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage(INVITE_ACCEPTED)
  @LogActivity({ action: 'accept:invite', resource: 'project-invite' })
  @ApiOperation({
    summary: 'Accept a received invite (authenticated)',
    description:
      'The authenticated user must be the invitee. ' +
      'Creates/reactivates project membership and triggers an INVITE_ACCEPTED notification to the inviter.',
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

  // ── POST /project-invites/:inviteId/decline ───────────────────────────────

  @Post('project-invites/:inviteId/decline')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ResponseMessage(INVITE_DECLINED)
  @LogActivity({ action: 'decline:invite', resource: 'project-invite' })
  @ApiOperation({
    summary: 'Decline a received invite',
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

  // ── POST /project-invites/accept (token-based, kept for email-link flow) ──

  @Post('project-invites/accept')
  @ResponseMessage(INVITE_ACCEPTED)
  @ApiOperation({
    summary: 'Accept an invite by one-time token (unauthenticated, email link flow)',
  })
  @ApiQuery({ name: 'token', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Invite accepted' })
  @ApiResponse({ status: 400, description: 'Token invalid or expired' })
  acceptInviteByToken(@Query('token') token: string) {
    return this.invitesService.acceptInvite(token);
  }
}
