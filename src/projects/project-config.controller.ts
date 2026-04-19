import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { WorkspaceGuard } from 'src/workspaces/guards/workspace.guard';
import { ResponseMessage } from 'src/common/decorators';
import {
  CreateProjectLabelDto,
  CreateProjectPriorityDto,
  CreateProjectSeverityDto,
  CreateProjectStatusDto,
  CreateProjectTaskTypeDto,
  UpdateProjectLabelDto,
  UpdateProjectPriorityDto,
  UpdateProjectSeverityDto,
  UpdateProjectStatusDto,
  UpdateProjectTaskTypeDto,
} from './dtos/project-config.dto';
import {
  CONFIG_LABEL_CREATED,
  CONFIG_LABEL_DELETED,
  CONFIG_LABEL_FETCHED,
  CONFIG_LABEL_UPDATED,
  CONFIG_LABELS_FETCHED,
  CONFIG_PRIORITIES_FETCHED,
  CONFIG_PRIORITY_CREATED,
  CONFIG_PRIORITY_DELETED,
  CONFIG_PRIORITY_FETCHED,
  CONFIG_PRIORITY_UPDATED,
  CONFIG_SEVERITIES_FETCHED,
  CONFIG_SEVERITY_CREATED,
  CONFIG_SEVERITY_DELETED,
  CONFIG_SEVERITY_FETCHED,
  CONFIG_SEVERITY_UPDATED,
  CONFIG_STATUSES_FETCHED,
  CONFIG_STATUS_CREATED,
  CONFIG_STATUS_DELETED,
  CONFIG_STATUS_FETCHED,
  CONFIG_STATUS_UPDATED,
  CONFIG_TASK_TYPE_CREATED,
  CONFIG_TASK_TYPE_DELETED,
  CONFIG_TASK_TYPE_FETCHED,
  CONFIG_TASK_TYPE_UPDATED,
  CONFIG_TASK_TYPES_FETCHED,
} from './messages';
import { ProjectConfigService } from './project-config.service';

@ApiTags('Project Config')
@Controller('projects/:projectId/config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard, ProjectPermissionGuard)
export class ProjectConfigController {
  constructor(private readonly configService: ProjectConfigService) {}

  // ── Statuses ───────────────────────────────────────────────────────────────

  @Get('statuses')
  @ApiOperation({ summary: 'List all statuses for a project' })
  @ApiResponse({ status: 200 })
  @ResponseMessage(CONFIG_STATUSES_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  listStatuses(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.configService.listStatuses(projectId);
  }

  @Get('statuses/:statusId')
  @ApiOperation({ summary: 'Get a single project status' })
  @ResponseMessage(CONFIG_STATUS_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  getStatus(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
  ) {
    return this.configService.getStatus(projectId, statusId);
  }

  @Post('statuses')
  @ApiOperation({ summary: 'Create a new status for a project' })
  @ApiResponse({ status: 201 })
  @ResponseMessage(CONFIG_STATUS_CREATED)
  @RequireProjectPermission('canManageProject')
  createStatus(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectStatusDto,
  ) {
    return this.configService.createStatus(projectId, dto);
  }

  @Patch('statuses/:statusId')
  @ApiOperation({ summary: 'Update a project status' })
  @ResponseMessage(CONFIG_STATUS_UPDATED)
  @RequireProjectPermission('canManageProject')
  updateStatus(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
    @Body() dto: UpdateProjectStatusDto,
  ) {
    return this.configService.updateStatus(projectId, statusId, dto);
  }

  @Delete('statuses/:statusId')
  @ApiOperation({ summary: 'Delete a project status' })
  @ResponseMessage(CONFIG_STATUS_DELETED)
  @RequireProjectPermission('canManageProject')
  deleteStatus(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
  ) {
    return this.configService.deleteStatus(projectId, statusId);
  }

  // ── Priorities ─────────────────────────────────────────────────────────────

  @Get('priorities')
  @ApiOperation({ summary: 'List all priorities for a project' })
  @ResponseMessage(CONFIG_PRIORITIES_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  listPriorities(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.configService.listPriorities(projectId);
  }

  @Get('priorities/:priorityId')
  @ApiOperation({ summary: 'Get a single project priority' })
  @ResponseMessage(CONFIG_PRIORITY_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  getPriority(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('priorityId', ParseUUIDPipe) priorityId: string,
  ) {
    return this.configService.getPriority(projectId, priorityId);
  }

  @Post('priorities')
  @ApiOperation({ summary: 'Create a new priority for a project' })
  @ApiResponse({ status: 201 })
  @ResponseMessage(CONFIG_PRIORITY_CREATED)
  @RequireProjectPermission('canManageProject')
  createPriority(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectPriorityDto,
  ) {
    return this.configService.createPriority(projectId, dto);
  }

  @Patch('priorities/:priorityId')
  @ApiOperation({ summary: 'Update a project priority' })
  @ResponseMessage(CONFIG_PRIORITY_UPDATED)
  @RequireProjectPermission('canManageProject')
  updatePriority(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('priorityId', ParseUUIDPipe) priorityId: string,
    @Body() dto: UpdateProjectPriorityDto,
  ) {
    return this.configService.updatePriority(projectId, priorityId, dto);
  }

  @Delete('priorities/:priorityId')
  @ApiOperation({ summary: 'Delete a project priority' })
  @ResponseMessage(CONFIG_PRIORITY_DELETED)
  @RequireProjectPermission('canManageProject')
  deletePriority(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('priorityId', ParseUUIDPipe) priorityId: string,
  ) {
    return this.configService.deletePriority(projectId, priorityId);
  }

  // ── Severities ─────────────────────────────────────────────────────────────

  @Get('severities')
  @ApiOperation({ summary: 'List all severities for a project' })
  @ResponseMessage(CONFIG_SEVERITIES_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  listSeverities(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.configService.listSeverities(projectId);
  }

  @Get('severities/:severityId')
  @ApiOperation({ summary: 'Get a single project severity' })
  @ResponseMessage(CONFIG_SEVERITY_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  getSeverity(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('severityId', ParseUUIDPipe) severityId: string,
  ) {
    return this.configService.getSeverity(projectId, severityId);
  }

  @Post('severities')
  @ApiOperation({ summary: 'Create a new severity for a project' })
  @ApiResponse({ status: 201 })
  @ResponseMessage(CONFIG_SEVERITY_CREATED)
  @RequireProjectPermission('canManageProject')
  createSeverity(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectSeverityDto,
  ) {
    return this.configService.createSeverity(projectId, dto);
  }

  @Patch('severities/:severityId')
  @ApiOperation({ summary: 'Update a project severity' })
  @ResponseMessage(CONFIG_SEVERITY_UPDATED)
  @RequireProjectPermission('canManageProject')
  updateSeverity(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('severityId', ParseUUIDPipe) severityId: string,
    @Body() dto: UpdateProjectSeverityDto,
  ) {
    return this.configService.updateSeverity(projectId, severityId, dto);
  }

  @Delete('severities/:severityId')
  @ApiOperation({ summary: 'Delete a project severity' })
  @ResponseMessage(CONFIG_SEVERITY_DELETED)
  @RequireProjectPermission('canManageProject')
  deleteSeverity(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('severityId', ParseUUIDPipe) severityId: string,
  ) {
    return this.configService.deleteSeverity(projectId, severityId);
  }

  // ── Task Types ─────────────────────────────────────────────────────────────

  @Get('task-types')
  @ApiOperation({ summary: 'List all task types for a project' })
  @ResponseMessage(CONFIG_TASK_TYPES_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  listTaskTypes(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.configService.listTaskTypes(projectId);
  }

  @Get('task-types/:typeId')
  @ApiOperation({ summary: 'Get a single project task type' })
  @ResponseMessage(CONFIG_TASK_TYPE_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  getTaskType(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('typeId', ParseUUIDPipe) typeId: string,
  ) {
    return this.configService.getTaskType(projectId, typeId);
  }

  @Post('task-types')
  @ApiOperation({ summary: 'Create a new task type for a project' })
  @ApiResponse({ status: 201 })
  @ResponseMessage(CONFIG_TASK_TYPE_CREATED)
  @RequireProjectPermission('canManageProject')
  createTaskType(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectTaskTypeDto,
  ) {
    return this.configService.createTaskType(projectId, dto);
  }

  @Patch('task-types/:typeId')
  @ApiOperation({ summary: 'Update a project task type' })
  @ResponseMessage(CONFIG_TASK_TYPE_UPDATED)
  @RequireProjectPermission('canManageProject')
  updateTaskType(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('typeId', ParseUUIDPipe) typeId: string,
    @Body() dto: UpdateProjectTaskTypeDto,
  ) {
    return this.configService.updateTaskType(projectId, typeId, dto);
  }

  @Delete('task-types/:typeId')
  @ApiOperation({ summary: 'Delete a project task type' })
  @ResponseMessage(CONFIG_TASK_TYPE_DELETED)
  @RequireProjectPermission('canManageProject')
  deleteTaskType(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('typeId', ParseUUIDPipe) typeId: string,
  ) {
    return this.configService.deleteTaskType(projectId, typeId);
  }

  // ── Labels ─────────────────────────────────────────────────────────────────

  @Get('labels')
  @ApiOperation({ summary: 'List all labels for a project' })
  @ResponseMessage(CONFIG_LABELS_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  listLabels(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.configService.listLabels(projectId);
  }

  @Get('labels/:labelId')
  @ApiOperation({ summary: 'Get a single project label' })
  @ResponseMessage(CONFIG_LABEL_FETCHED)
  @RequireProjectPermission('taskManagement', 'view')
  getLabel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ) {
    return this.configService.getLabel(projectId, labelId);
  }

  @Post('labels')
  @ApiOperation({ summary: 'Create a new label for a project' })
  @ApiResponse({ status: 201 })
  @ResponseMessage(CONFIG_LABEL_CREATED)
  @RequireProjectPermission('canManageProject')
  createLabel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectLabelDto,
  ) {
    return this.configService.createLabel(projectId, dto);
  }

  @Patch('labels/:labelId')
  @ApiOperation({ summary: 'Update a project label' })
  @ResponseMessage(CONFIG_LABEL_UPDATED)
  @RequireProjectPermission('canManageProject')
  updateLabel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateProjectLabelDto,
  ) {
    return this.configService.updateLabel(projectId, labelId, dto);
  }

  @Delete('labels/:labelId')
  @ApiOperation({ summary: 'Delete a project label' })
  @ResponseMessage(CONFIG_LABEL_DELETED)
  @RequireProjectPermission('canManageProject')
  deleteLabel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ) {
    return this.configService.deleteLabel(projectId, labelId);
  }
}
