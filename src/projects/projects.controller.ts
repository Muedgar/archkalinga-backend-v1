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
import { JwtAuthGuard, PermissionGuard } from 'src/auth/guards';
import { GetUser, RequirePermission } from 'src/auth/decorators';
import { LogActivity, ResponseMessage } from 'src/common/decorators';
import type { RequestUser } from 'src/auth/types';
import { CreateProjectDto, ProjectFiltersDto, UpdateProjectDto } from './dtos';
import {
  PROJECT_CREATED,
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
  @ApiOperation({ summary: 'Create a new project in the current organization' })
  @ApiResponse({ status: 201, description: 'Project created with memberships and activity log' })
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
      'Admins see all organization projects. Regular members only see projects they belong to.',
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
    description: 'Returns full detail including template, members, invites, and recent activity.',
  })
  @ApiResponse({ status: 200, description: 'Project detail' })
  @ApiResponse({ status: 403, description: 'Not a member of this project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ResponseMessage(PROJECT_FETCHED)
  @UseGuards(PermissionGuard)
  @RequirePermission('projectManagement', 'view')
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
      'All fields optional. memberIds replaces the current member list (OWNER never removed).',
  })
  @ApiResponse({ status: 200, description: 'Updated project detail' })
  @ApiResponse({ status: 400, description: 'Member not in organization' })
  @ApiResponse({ status: 404, description: 'Project or template not found' })
  @ResponseMessage(PROJECT_UPDATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('projectManagement', 'update')
  @LogActivity({ action: 'update:project', resource: 'project', includeBody: true })
  updateProject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @GetUser() user: RequestUser,
  ) {
    return this.projectsService.updateProject(id, dto, user);
  }
}
