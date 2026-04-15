import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ResponseMessage, LogActivity } from 'src/common/decorators';
import { ListFilterDTO } from 'src/common/dtos';
import { UpdateMyProfileDto, UpdateUserDTO, UserSearchDto } from './dtos';
import { CreateUserDTO } from './dtos/create-user.dto';
import { AdminResetPasswordDto } from './dtos/admin-reset-password.dto';
import {
  MY_PROFILE_FETCHED,
  MY_PROFILE_UPDATED,
  USERS_FETCHED,
  USERS_SEARCHED,
  USER_CREATED,
  USER_FETCHED,
  USER_UPDATED,
  USER_PASSWORD_RESET,
} from './messages';
import { UserService } from './users.service';
import { JwtAuthGuard, PermissionGuard } from 'src/auth/guards';
import { GetUser, RequirePermission } from 'src/auth/decorators';
import { WorkspaceGuard } from 'src/workspaces/guards/workspace.guard';
import { GetWorkspaceMember } from 'src/workspaces/decorators/get-workspace-member.decorator';
import type { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import type { RequestUser } from 'src/auth/types';

@Controller('users')
@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @ApiOperation({ summary: 'Create a collaborator in the current workspace and assign a role' })
  @ApiResponse({ status: 201, description: 'User created with workspace membership and welcome email dispatched' })
  @ApiResponse({ status: 400, description: 'Validation error or email already in use' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.create)' })
  @ResponseMessage(USER_CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('userManagement', 'create')
  @LogActivity({ action: 'create:user', resource: 'user', includeBody: true })
  createUser(
    @Body() dto: CreateUserDTO,
    @GetUser() requestingUser: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.userService.createUser(dto, member.workspaceId, requestingUser.id);
  }

  @Get()
  @ApiOperation({ summary: 'List collaborators in the current workspace' })
  @ApiResponse({ status: 200, description: 'Paginated list of workspace users' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.view)' })
  @ResponseMessage(USERS_FETCHED)
  @UseGuards(PermissionGuard)
  @RequirePermission('userManagement', 'view')
  getUsers(
    @Query() filters: ListFilterDTO,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.userService.getUsers(filters, member.workspaceId);
  }

  // ── GET  /users/me ─────────────────────────────────────────────────────────
  // ── PATCH /users/me/profile ─────────────────────────────────────────────────
  //
  // Self-service profile routes. Must be declared BEFORE :id routes so NestJS
  // does not swallow "me" as a UUID param.

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated user's own profile" })
  @ApiResponse({ status: 200, description: 'User profile object' })
  @ResponseMessage(MY_PROFILE_FETCHED)
  getMyProfile(@GetUser() requestUser: RequestUser) {
    return this.userService.getMyProfile(requestUser.id);
  }

  @Patch('me/profile')
  @ApiOperation({
    summary: "Update the authenticated user's own profile",
    description:
      'Updates self-service fields: name, username, title, and isPublicProfile discoverability flag. ' +
      'Admin-only fields (status, email, role) must be changed via PATCH /users/:id.',
  })
  @ApiResponse({ status: 200, description: 'Updated user profile' })
  @ResponseMessage(MY_PROFILE_UPDATED)
  @LogActivity({ action: 'update:own-profile', resource: 'user', includeBody: true })
  updateMyProfile(@GetUser() requestUser: RequestUser, @Body() dto: UpdateMyProfileDto) {
    return this.userService.updateMyProfile(requestUser.id, dto);
  }

  // ── GET /users/search ──────────────────────────────────────────────────────
  //
  // Must be declared BEFORE :id route so NestJS does not swallow "search"
  // as an id param.

  @Get('search')
  @ApiOperation({
    summary: 'Search for publicly discoverable users across all workspaces',
    description:
      'Returns users whose profile is public (isPublicProfile = true) or whose workspace has allowPublicProfiles enabled. ' +
      'Matched against first name, last name, username, email, and workspace name/slug. ' +
      'Requires authentication — no specific workspace permission needed. ' +
      'Use excludeProjectId to filter out users already in a project before sending an invite.',
  })
  @ApiResponse({ status: 200, description: 'Paginated user search results' })
  @ResponseMessage(USERS_SEARCHED)
  searchUsers(@Query() dto: UserSearchDto) {
    return this.userService.searchUsers(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workspace collaborator by ID' })
  @ApiResponse({ status: 200, description: 'User object' })
  @ApiResponse({ status: 404, description: 'User not found in this workspace' })
  @ResponseMessage(USER_FETCHED)
  getUser(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.userService.getUserById(id, member.workspaceId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a collaborator and optionally change their workspace role',
  })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.update)' })
  @ResponseMessage(USER_UPDATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('userManagement', 'update')
  @LogActivity({ action: 'update:user', resource: 'user', includeBody: true })
  updateUser(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDTO,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.userService.updateUser(id, dto, member.workspaceId);
  }

  @Patch(':id/password')
  @ApiOperation({ summary: "Reset a collaborator's password (admin action)" })
  @ApiResponse({ status: 200, description: 'Password reset' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.update)' })
  @ResponseMessage(USER_PASSWORD_RESET)
  @UseGuards(PermissionGuard)
  @RequirePermission('userManagement', 'update')
  @LogActivity({ action: 'reset:user-password', resource: 'user' })
  adminResetPassword(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AdminResetPasswordDto,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.userService.adminResetPassword(id, dto.newPassword, member.workspaceId);
  }
}
