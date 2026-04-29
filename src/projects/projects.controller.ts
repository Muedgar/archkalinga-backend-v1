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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  PermissionGuard,
  ProjectPermissionGuard,
} from 'src/auth/guards';
import {
  GetUser,
  RequirePermission,
  RequireProjectPermission,
} from 'src/auth/decorators';
import { WorkspaceGuard } from 'src/workspaces/guards/workspace.guard';
import { GetWorkspaceMember } from 'src/workspaces/decorators/get-workspace-member.decorator';
import type { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { LogActivity, ResponseMessage } from 'src/common/decorators';
import type { RequestUser } from 'src/auth/types';
import {
  CreateProjectDto,
  ProjectFiltersDto,
  UpdateProjectDto,
  UpdateProjectMemberRoleDto,
} from './dtos';
import {
  PROJECT_CREATED,
  PROJECT_DELETED,
  PROJECT_FETCHED,
  PROJECT_MEMBER_ROLE_UPDATED,
  PROJECT_MEMBERS_FETCHED,
  PROJECT_UPDATED,
  PROJECTS_FETCHED,
} from './messages';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@Controller('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new project in the current workspace' })
  @ApiResponse({ status: 201, description: 'Project created with default roles, workflow columns, seeded tasks, and activity logs' })
  @ResponseMessage(PROJECT_CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('projectManagement', 'create')
  @LogActivity({ action: 'create:project', resource: 'project', includeBody: true })
  createProject(
    @Body() dto: CreateProjectDto,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.projectsService.createProject(dto, user, member.workspaceId, member);
  }

  @Get()
  @ApiOperation({
    summary: 'List projects visible to the current user in this workspace',
    description:
      'Returns only projects where the caller has an active project membership. ' +
      'No workspace-level permission is required — any workspace member (including guests ' +
      'auto-enrolled on invite accept) can call this endpoint and will only see their own projects.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of projects' })
  @ResponseMessage(PROJECTS_FETCHED)
  getProjects(
    @Query() filters: ProjectFiltersDto,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.projectsService.getProjects(filters, user, member.workspaceId, member);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single project by UUID' })
  @ApiResponse({ status: 200, description: 'Project detail' })
  @ResponseMessage(PROJECT_FETCHED)
  @UseGuards(ProjectPermissionGuard) // membership verified by service; no specific permission required
  getProject(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.projectsService.getProject(
      id,
      user,
      member.workspaceId,
      member,
      req.projectMembership,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiResponse({ status: 200, description: 'Updated project detail' })
  @ResponseMessage(PROJECT_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('canManageProject')
  @LogActivity({ action: 'update:project', resource: 'project', includeBody: true })
  updateProject(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.projectsService.updateProject(
      id,
      dto,
      user,
      member.workspaceId,
      member,
      req.projectMembership,
    );
  }

  @Get(':projectId/members')
  @ApiOperation({ summary: 'List active members of a project' })
  @ApiResponse({ status: 200, description: 'List of active project members with their roles' })
  @ResponseMessage(PROJECT_MEMBERS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  listProjectMembers(
    @Req() req: any,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.projectsService.listMembers(
      projectId,
      user,
      member.workspaceId,
      member,
      req.projectMembership,
    );
  }

  @Patch(':projectId/members/:memberId/role')
  @ApiOperation({ summary: 'Update a project member role' })
  @ApiResponse({ status: 200, description: 'Updated project detail with refreshed member roles' })
  @ResponseMessage(PROJECT_MEMBER_ROLE_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('canManageProject')
  @LogActivity({ action: 'update:project-member-role', resource: 'project-membership', includeBody: true })
  updateProjectMemberRole(
    @Req() req: any,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateProjectMemberRoleDto,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.projectsService.updateMemberRole(
      projectId,
      memberId,
      dto,
      user,
      member.workspaceId,
      member,
      req.projectMembership,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a project' })
  @ApiResponse({ status: 200, description: 'Project deleted' })
  @ResponseMessage(PROJECT_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('canManageProject')
  @LogActivity({ action: 'delete:project', resource: 'project' })
  deleteProject(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.projectsService.deleteProject(
      id,
      user,
      member.workspaceId,
      member,
      req.projectMembership,
    );
  }
}
