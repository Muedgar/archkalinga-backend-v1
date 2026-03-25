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
import { JwtAuthGuard, PermissionGuard } from 'src/auth/guards';
import { GetUser, RequirePermission } from 'src/auth/decorators';
import { User } from 'src/users/entities';
import { CreateRoleDTO, UpdateRoleDTO } from './dtos';
import {
  ROLE_CREATED,
  ROLE_FETCHED,
  ROLES_FETCHED,
  ROLE_UPDATED,
} from './messages';
import { RoleService } from './roles.service';

@ApiTags('Roles')
@Controller('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @ApiOperation({ summary: 'Create a role for the current organization' })
  @ApiResponse({ status: 201, description: 'Role created with the supplied permission matrix' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires roleManagement.create)' })
  @ResponseMessage(ROLE_CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('roleManagement', 'create')
  @LogActivity({ action: 'create:role', resource: 'role', includeBody: true })
  createRole(@Body() dto: CreateRoleDTO, @GetUser() user: User) {
    return this.roleService.createRole(dto, user.organizationId);
  }

  @Get()
  @ApiOperation({ summary: 'List roles in the current organization' })
  @ApiResponse({ status: 200, description: 'Paginated list of roles' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires roleManagement.view)' })
  @ResponseMessage(ROLES_FETCHED)
  @UseGuards(PermissionGuard)
  @RequirePermission('roleManagement', 'view')
  getRoles(@Query() filters: ListFilterDTO, @GetUser() user: User) {
    return this.roleService.getRoles(filters, user.organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ status: 200, description: 'Role object with full permission matrix' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 404, description: 'Role not found in this organization' })
  @ResponseMessage(ROLE_FETCHED)
  getRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @GetUser() user: User,
  ) {
    return this.roleService.getRoleById(id, user.organizationId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a role name or permission matrix' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires roleManagement.update)' })
  @ApiResponse({ status: 404, description: 'Role not found in this organization' })
  @ResponseMessage(ROLE_UPDATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('roleManagement', 'update')
  @LogActivity({ action: 'update:role', resource: 'role', includeBody: true })
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateRoleDTO,
    @GetUser() user: User,
  ) {
    return this.roleService.updateRole(id, dto, user.organizationId);
  }
}
