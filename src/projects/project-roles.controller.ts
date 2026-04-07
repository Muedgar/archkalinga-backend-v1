import {
  Body,
  Controller,
  Delete,
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
import { JwtAuthGuard, ProjectPermissionGuard } from 'src/auth/guards';
import { RequireProjectPermission } from 'src/auth/decorators';
import { LogActivity, ResponseMessage } from 'src/common/decorators';
import { ListFilterDTO } from 'src/common/dtos';
import {
  PROJECT_ROLE_CREATED,
  PROJECT_ROLE_DELETED,
  PROJECT_ROLE_FETCHED,
  PROJECT_ROLE_UPDATED,
  PROJECT_ROLES_FETCHED,
} from './messages';
import { CreateProjectRoleDto } from './dtos/create-project-role.dto';
import { UpdateProjectRoleDto } from './dtos/update-project-role.dto';
import { ProjectRolesService } from './project-roles.service';

@ApiTags('Project Roles')
@Controller('projects/:projectId/roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ProjectRolesController {
  constructor(private readonly projectRolesService: ProjectRolesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a custom project role',
    description:
      "Project-scoped settings action. Requires projectManagement.update through the caller's active project role.",
  })
  @ApiResponse({ status: 201, description: 'Project role created' })
  @ResponseMessage(PROJECT_ROLE_CREATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'update')
  @LogActivity({ action: 'create:project-role', resource: 'project-role', includeBody: true })
  createProjectRole(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectRoleDto,
  ) {
    return this.projectRolesService.createProjectRole(projectId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List project roles',
    description:
      "Project-scoped settings action. Requires projectManagement.view through the caller's active project role.",
  })
  @ApiResponse({ status: 200, description: 'Paginated list of project roles' })
  @ResponseMessage(PROJECT_ROLES_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'view')
  listProjectRoles(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() filters: ListFilterDTO,
  ) {
    return this.projectRolesService.listProjectRoles(projectId, filters);
  }

  @Get(':roleId')
  @ApiOperation({
    summary: 'Get a single project role',
    description:
      "Project-scoped settings action. Requires projectManagement.view through the caller's active project role.",
  })
  @ApiResponse({ status: 200, description: 'Project role detail' })
  @ResponseMessage(PROJECT_ROLE_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'view')
  getProjectRole(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.projectRolesService.getProjectRoleById(projectId, roleId);
  }

  @Patch(':roleId')
  @ApiOperation({
    summary: 'Update a project role',
    description:
      "Project-scoped settings action. Requires projectManagement.update through the caller's active project role. System roles keep stable internal slugs when renamed.",
  })
  @ApiResponse({ status: 200, description: 'Project role updated' })
  @ResponseMessage(PROJECT_ROLE_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'update')
  @LogActivity({ action: 'update:project-role', resource: 'project-role', includeBody: true })
  updateProjectRole(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateProjectRoleDto,
  ) {
    return this.projectRolesService.updateProjectRole(projectId, roleId, dto);
  }

  @Delete(':roleId')
  @ApiOperation({
    summary: 'Delete a project role',
    description:
      "Project-scoped settings action. Requires projectManagement.update through the caller's active project role. Protected roles and roles still used by memberships or pending invites cannot be deleted.",
  })
  @ApiResponse({ status: 200, description: 'Project role deleted' })
  @ResponseMessage(PROJECT_ROLE_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'update')
  @LogActivity({ action: 'delete:project-role', resource: 'project-role' })
  deleteProjectRole(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.projectRolesService.deleteProjectRole(projectId, roleId);
  }
}
