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
import { JwtAuthGuard, PermissionGuard, ProjectPermissionGuard } from 'src/auth/guards';
import {
  GetUser,
  RequirePermission,
  RequireProjectPermission,
} from 'src/auth/decorators';
import { LogActivity, ResponseMessage } from 'src/common/decorators';
import type { RequestUser } from 'src/auth/types';
import { CreateProjectDto, ProjectFiltersDto, UpdateProjectDto } from './dtos';
import {
  PROJECT_CREATED,
  PROJECT_DELETED,
  PROJECT_FETCHED,
  PROJECT_UPDATED,
  PROJECTS_FETCHED,
} from './messages';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@Controller('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── POST /projects ──────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({
    summary: 'Create a new project in the current organization and seed its board from the template',
    description:
      'Workspace-scoped action. Requires workspace permission to create projects, then creates default project roles and seeds memberships/tasks from the selected template.',
  })
  @ApiResponse({ status: 201, description: 'Project created with default project roles, memberships, workflow columns, seeded tasks, and activity logs' })
  @ApiResponse({ status: 400, description: 'Validation error or member not in organization' })
  @ApiResponse({ status: 404, description: 'Template not found in organization' })
  @ResponseMessage(PROJECT_CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('projectManagement', 'create')
  @LogActivity({ action: 'create:project', resource: 'project', includeBody: true })
  createProject(
    @Body() dto: CreateProjectDto,
    @GetUser() user: RequestUser,
  ) {
    return this.projectsService.createProject(dto, user);
  }

  // ── GET /projects ───────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List projects visible to the current user',
    description:
      'Workspace-scoped listing. Admins see all organization projects. Regular users only see projects where their active project role grants project view access.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of projects' })
  @ResponseMessage(PROJECTS_FETCHED)
  @UseGuards(PermissionGuard)
  @RequirePermission('projectManagement', 'view')
  getProjects(
    @Query() filters: ProjectFiltersDto,
    @GetUser() user: RequestUser,
  ) {
    return this.projectsService.getProjects(filters, user);
  }

  // ── GET /projects/:id ───────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single project by UUID',
    description:
      'Project-scoped action. Requires projectManagement.view on the caller\'s active project membership role. Returns template, seeded project roles with permission matrices, members with project-role assignments, invites, and recent activity.',
  })
  @ApiResponse({ status: 200, description: 'Project detail' })
  @ApiResponse({ status: 403, description: 'Not a member of this project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ResponseMessage(PROJECT_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'view')
  getProject(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: RequestUser,
  ) {
    return this.projectsService.getProject(id, user);
  }

  // ── PATCH /projects/:id ─────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a project',
    description:
      'Project-scoped action. Requires projectManagement.update on the caller\'s active project membership role. All fields optional. memberIds replaces the current member list (the Owner project role is never removed). templateId cannot be changed after project tasks exist.',
  })
  @ApiResponse({ status: 200, description: 'Updated project detail' })
  @ApiResponse({ status: 400, description: 'Member not in organization' })
  @ApiResponse({ status: 404, description: 'Project or template not found' })
  @ResponseMessage(PROJECT_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'update')
  @LogActivity({ action: 'update:project', resource: 'project', includeBody: true })
  updateProject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @GetUser() user: RequestUser,
  ) {
    return this.projectsService.updateProject(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a project',
    description:
      'Project-scoped action. Requires projectManagement.delete on the caller\'s active project membership role. Deletes the project and its dependent memberships, workflow columns, tasks, and related records.',
  })
  @ApiResponse({ status: 200, description: 'Project deleted' })
  @ApiResponse({ status: 403, description: 'Not a member of this project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ResponseMessage(PROJECT_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('projectManagement', 'delete')
  @LogActivity({ action: 'delete:project', resource: 'project' })
  deleteProject(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: RequestUser,
  ) {
    return this.projectsService.deleteProject(id, user);
  }
}
