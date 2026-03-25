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
import { UpdateUserDTO } from './dtos';
import { CreateUserDTO } from './dtos/create-user.dto';
import { AdminResetPasswordDto } from './dtos/admin-reset-password.dto';
import {
  USERS_FETCHED,
  USER_CREATED,
  USER_FETCHED,
  USER_UPDATED,
  USER_PASSWORD_RESET,
} from './messages';
import { UserService } from './users.service';
import { JwtAuthGuard, PermissionGuard } from 'src/auth/guards';
import { GetUser, RequirePermission } from 'src/auth/decorators';
import { User } from './entities';

@Controller('users')
@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @ApiOperation({ summary: 'Create a collaborator in the current organization' })
  @ApiResponse({ status: 201, description: 'User created and welcome email dispatched' })
  @ApiResponse({ status: 400, description: 'Validation error or email already in use' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.create)' })
  @ResponseMessage(USER_CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('userManagement', 'create')
  @LogActivity({ action: 'create:user', resource: 'user', includeBody: true })
  createUser(
    @Body() dto: CreateUserDTO,
    @GetUser() requestingUser: User,
  ) {
    return this.userService.createUser(dto, requestingUser.organizationId, requestingUser.id);
  }

  @Get()
  @ApiOperation({ summary: 'List collaborators in the current organization' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.view)' })
  @ResponseMessage(USERS_FETCHED)
  @UseGuards(PermissionGuard)
  @RequirePermission('userManagement', 'view')
  getUsers(
    @Query() filters: ListFilterDTO,
    @GetUser() user: User,
  ) {
    return this.userService.getUsers(filters, user.organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a collaborator by ID' })
  @ApiResponse({ status: 200, description: 'User object' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 404, description: 'User not found in this organization' })
  @ResponseMessage(USER_FETCHED)
  getUser(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @GetUser() user: User,
  ) {
    return this.userService.getUserById(id, user.organizationId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a collaborator' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.update)' })
  @ApiResponse({ status: 404, description: 'User not found in this organization' })
  @ResponseMessage(USER_UPDATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('userManagement', 'update')
  @LogActivity({ action: 'update:user', resource: 'user', includeBody: true })
  updateUser(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDTO,
    @GetUser() user: User,
  ) {
    return this.userService.updateUser(id, dto, user.organizationId);
  }

  @Patch(':id/password')
  @ApiOperation({ summary: "Reset a collaborator's password (admin action)" })
  @ApiResponse({ status: 200, description: 'Password reset — user flagged for password change on next login' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.update)' })
  @ApiResponse({ status: 404, description: 'User not found in this organization' })
  @ResponseMessage(USER_PASSWORD_RESET)
  @UseGuards(PermissionGuard)
  @RequirePermission('userManagement', 'update')
  @LogActivity({ action: 'reset:user-password', resource: 'user' })
  adminResetPassword(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AdminResetPasswordDto,
    @GetUser() user: User,
  ) {
    return this.userService.adminResetPassword(id, dto.newPassword, user.organizationId);
  }
}
