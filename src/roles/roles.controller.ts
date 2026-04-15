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
import { RequirePermission } from 'src/auth/decorators';
import { WorkspaceGuard } from 'src/workspaces/guards/workspace.guard';
import { GetWorkspaceMember } from 'src/workspaces/decorators/get-workspace-member.decorator';
import type { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { CreateRoleDTO, UpdateRoleDTO } from './dtos';
import {
  ROLE_CREATED,
  ROLE_FETCHED,
  ROLES_FETCHED,
  ROLE_UPDATED,
} from './messages';
import { RoleService } from './roles.service';

@ApiTags('Workspace Roles')
@Controller('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @ApiOperation({ summary: 'Create a workspace role for the current workspace' })
  @ApiResponse({ status: 201, description: 'Workspace role created with the supplied permission matrix' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires roleManagement.create)' })
  @ResponseMessage(ROLE_CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('roleManagement', 'create')
  @LogActivity({ action: 'create:role', resource: 'role', includeBody: true })
  createRole(@Body() dto: CreateRoleDTO, @GetWorkspaceMember() member: WorkspaceMember) {
    return this.roleService.createRole(dto, member.workspaceId);
  }

  @Get()
  @ApiOperation({ summary: 'List workspace roles in the current workspace' })
  @ApiResponse({ status: 200, description: 'Paginated list of workspace roles' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires roleManagement.view)' })
  @ResponseMessage(ROLES_FETCHED)
  @UseGuards(PermissionGuard)
  @RequirePermission('roleManagement', 'view')
  getRoles(@Query() filters: ListFilterDTO, @GetWorkspaceMember() member: WorkspaceMember) {
    return this.roleService.getRoles(filters, member.workspaceId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workspace role by ID' })
  @ApiResponse({ status: 200, description: 'Workspace role with full permission matrix' })
  @ApiResponse({ status: 404, description: 'Role not found in this workspace' })
  @ResponseMessage(ROLE_FETCHED)
  getRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.roleService.getRoleById(id, member.workspaceId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a workspace role name or permission matrix' })
  @ApiResponse({ status: 200, description: 'Workspace role updated' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires roleManagement.update)' })
  @ApiResponse({ status: 404, description: 'Role not found in this workspace' })
  @ResponseMessage(ROLE_UPDATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('roleManagement', 'update')
  @LogActivity({ action: 'update:role', resource: 'role', includeBody: true })
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateRoleDTO,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.roleService.updateRole(id, dto, member.workspaceId);
  }
}
