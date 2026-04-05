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
import { GetUser, RequireProjectPermission } from 'src/auth/decorators';
import { JwtAuthGuard, ProjectPermissionGuard } from 'src/auth/guards';
import type { RequestUser } from 'src/auth/types';
import { LogActivity, ResponseMessage } from 'src/common/decorators';
import {
  AddChecklistItemDto,
  AddCommentDto,
  AddDependencyDto,
  BulkUpdateTasksDto,
  CreateTaskDto,
  CreateWorkflowColumnDto,
  MoveTaskDto,
  TaskFiltersDto,
  UpdateChecklistItemDto,
  UpdateCommentDto,
  UpdateTaskDto,
  UpdateWorkflowColumnDto,
} from './dtos';
import {
  TASK_CHECKLIST_FETCHED,
  TASK_CHECKLIST_ITEM_ADDED,
  TASK_CHECKLIST_ITEM_DELETED,
  TASK_CHECKLIST_ITEM_UPDATED,
  TASK_COMMENT_ADDED,
  TASK_COMMENT_DELETED,
  TASK_COMMENT_UPDATED,
  TASK_COMMENTS_FETCHED,
  TASK_DEPENDENCIES_FETCHED,
  TASK_DEPENDENCY_ADDED,
  TASK_DEPENDENCY_DELETED,
  TASK_MOVED,
  TASKS_BULK_UPDATED,
  TASK_CREATED,
  TASK_DELETED,
  TASK_FETCHED,
  TASK_UPDATED,
  TASKS_FETCHED,
  WORKFLOW_COLUMN_CREATED,
  WORKFLOW_COLUMN_DELETED,
  WORKFLOW_COLUMNS_FETCHED,
  WORKFLOW_COLUMN_UPDATED,
} from './messages';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@Controller('projects/:projectId')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('tasks')
  @ApiOperation({
    summary: 'List project tasks',
    description:
      'Project-scoped action. Requires taskManagement.view through the caller\'s active project role.',
  })
  @ApiResponse({ status: 200, description: 'Tasks fetched' })
  @ResponseMessage(TASKS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectTasks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() filters: TaskFiltersDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectTasks(projectId, filters, user);
  }

  @Post('tasks')
  @ApiOperation({
    summary: 'Create a task in a project',
    description:
      'Project-scoped action. Requires taskManagement.create through the caller\'s active project role.',
  })
  @ApiResponse({ status: 201, description: 'Task created' })
  @ResponseMessage(TASK_CREATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'create')
  @LogActivity({ action: 'create:task', resource: 'task', includeBody: true })
  createTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.createTask(projectId, dto, user);
  }

  @Patch('tasks/bulk')
  @ApiOperation({
    summary: 'Bulk update tasks in a project',
    description:
      'Project-scoped action. Requires taskManagement.update through the caller\'s active project role. Supports Gantt-oriented bulk edits for status, progress, dates, positioning, and optional viewMeta updates.',
  })
  @ApiResponse({ status: 200, description: 'Tasks updated' })
  @ResponseMessage(TASKS_BULK_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'bulk-update:task', resource: 'task', includeBody: true })
  bulkUpdateTasks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: BulkUpdateTasksDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.bulkUpdateTasks(projectId, dto, user);
  }

  @Get('tasks/:taskId')
  @ApiOperation({
    summary: 'Get a single task',
    description:
      'Project-scoped action. Requires taskManagement.view through the caller\'s active project role.',
  })
  @ApiResponse({ status: 200, description: 'Task fetched' })
  @ResponseMessage(TASK_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTask(projectId, taskId, user);
  }

  @Patch('tasks/:taskId')
  @ApiOperation({
    summary: 'Update a task',
    description:
      'Project-scoped action. Requires taskManagement.update through the caller\'s active project role. Supports timeline edits for startDate, endDate, progress, dependencyIds, and optional viewMeta.gantt updates.',
  })
  @ApiResponse({ status: 200, description: 'Task updated' })
  @ResponseMessage(TASK_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'update:task', resource: 'task', includeBody: true })
  updateTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateTask(projectId, taskId, dto, user);
  }

  @Patch('tasks/:taskId/position')
  @ApiOperation({
    summary: 'Move or reorder a task',
    description:
      'Project-scoped action. Requires taskManagement.update through the caller\'s active project role. Supports drag-and-drop across workflow columns, sibling reordering, and subtask reparenting.',
  })
  @ApiResponse({ status: 200, description: 'Task moved' })
  @ResponseMessage(TASK_MOVED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'move:task', resource: 'task', includeBody: true })
  moveTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: MoveTaskDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.moveTask(projectId, taskId, dto, user);
  }

  @Delete('tasks/:taskId')
  @ApiOperation({
    summary: 'Soft-delete a task',
    description:
      'Project-scoped action. Requires taskManagement.delete through the caller\'s active project role. Soft-deletes the selected task and its descendant subtasks, then returns delete summary metadata for the frontend.',
  })
  @ApiResponse({ status: 200, description: 'Task deleted' })
  @ResponseMessage(TASK_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'delete')
  @LogActivity({ action: 'delete:task', resource: 'task' })
  deleteTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteTask(projectId, taskId, user);
  }

  @Get('tasks/:taskId/comments')
  @ApiOperation({ summary: 'List task comments' })
  @ApiResponse({ status: 200, description: 'Task comments fetched' })
  @ResponseMessage(TASK_COMMENTS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTaskComments(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskComments(projectId, taskId, user);
  }

  @Post('tasks/:taskId/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  @ApiResponse({ status: 201, description: 'Task comment added' })
  @ResponseMessage(TASK_COMMENT_ADDED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'create')
  @LogActivity({ action: 'create:task-comment', resource: 'task-comment', includeBody: true })
  addTaskComment(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddCommentDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.addTaskComment(projectId, taskId, dto, user);
  }

  @Patch('tasks/:taskId/comments/:commentId')
  @ApiOperation({ summary: 'Update a task comment' })
  @ApiResponse({ status: 200, description: 'Task comment updated' })
  @ResponseMessage(TASK_COMMENT_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'update:task-comment', resource: 'task-comment', includeBody: true })
  updateTaskComment(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateTaskComment(projectId, taskId, commentId, dto, user);
  }

  @Delete('tasks/:taskId/comments/:commentId')
  @ApiOperation({ summary: 'Soft-delete a task comment' })
  @ApiResponse({ status: 200, description: 'Task comment deleted' })
  @ResponseMessage(TASK_COMMENT_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'delete')
  @LogActivity({ action: 'delete:task-comment', resource: 'task-comment' })
  deleteTaskComment(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteTaskComment(projectId, taskId, commentId, user);
  }

  @Get('tasks/:taskId/checklist')
  @ApiOperation({ summary: 'List task checklist items' })
  @ApiResponse({ status: 200, description: 'Task checklist fetched' })
  @ResponseMessage(TASK_CHECKLIST_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTaskChecklist(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskChecklist(projectId, taskId, user);
  }

  @Post('tasks/:taskId/checklist')
  @ApiOperation({ summary: 'Add a checklist item to a task' })
  @ApiResponse({ status: 201, description: 'Checklist item added' })
  @ResponseMessage(TASK_CHECKLIST_ITEM_ADDED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'create:task-checklist-item', resource: 'task-checklist-item', includeBody: true })
  addChecklistItem(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddChecklistItemDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.addChecklistItem(projectId, taskId, dto, user);
  }

  @Patch('tasks/:taskId/checklist/:itemId')
  @ApiOperation({ summary: 'Update a task checklist item' })
  @ApiResponse({ status: 200, description: 'Checklist item updated' })
  @ResponseMessage(TASK_CHECKLIST_ITEM_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'update:task-checklist-item', resource: 'task-checklist-item', includeBody: true })
  updateChecklistItem(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateChecklistItem(projectId, taskId, itemId, dto, user);
  }

  @Delete('tasks/:taskId/checklist/:itemId')
  @ApiOperation({ summary: 'Delete a task checklist item' })
  @ApiResponse({ status: 200, description: 'Checklist item deleted' })
  @ResponseMessage(TASK_CHECKLIST_ITEM_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'delete:task-checklist-item', resource: 'task-checklist-item' })
  deleteChecklistItem(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteChecklistItem(projectId, taskId, itemId, user);
  }

  @Get('tasks/:taskId/dependencies')
  @ApiOperation({ summary: 'List task dependencies' })
  @ApiResponse({ status: 200, description: 'Task dependencies fetched' })
  @ResponseMessage(TASK_DEPENDENCIES_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTaskDependencies(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskDependencies(projectId, taskId, user);
  }

  @Post('tasks/:taskId/dependencies')
  @ApiOperation({ summary: 'Add a dependency to a task' })
  @ApiResponse({ status: 201, description: 'Task dependency added' })
  @ResponseMessage(TASK_DEPENDENCY_ADDED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'create:task-dependency', resource: 'task-dependency', includeBody: true })
  addTaskDependency(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddDependencyDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.addTaskDependency(projectId, taskId, dto, user);
  }

  @Delete('tasks/:taskId/dependencies/:depId')
  @ApiOperation({ summary: 'Delete a dependency from a task' })
  @ApiResponse({ status: 200, description: 'Task dependency deleted' })
  @ResponseMessage(TASK_DEPENDENCY_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'delete:task-dependency', resource: 'task-dependency' })
  deleteTaskDependency(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('depId', ParseUUIDPipe) depId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteTaskDependency(projectId, taskId, depId, user);
  }

  @Get('columns')
  @ApiOperation({
    summary: 'List workflow columns for a project',
    description:
      'Project-scoped action. Requires taskManagement.view through the caller\'s active project role. Returns Kanban-ready column metadata including task counts, orderIndex, and locked state.',
  })
  @ApiResponse({ status: 200, description: 'Workflow columns fetched' })
  @ResponseMessage(WORKFLOW_COLUMNS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getWorkflowColumns(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getWorkflowColumns(projectId, user);
  }

  @Post('columns')
  @ApiOperation({
    summary: 'Create a workflow column for a project',
    description:
      'Project-scoped action. Requires taskManagement.create through the caller\'s active project role. New columns are created unlocked and column ordering is normalized automatically.',
  })
  @ApiResponse({ status: 201, description: 'Workflow column created' })
  @ResponseMessage(WORKFLOW_COLUMN_CREATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'create')
  @LogActivity({ action: 'create:workflow-column', resource: 'workflow-column', includeBody: true })
  createWorkflowColumn(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateWorkflowColumnDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.createWorkflowColumn(projectId, dto, user);
  }

  @Patch('columns/:columnId')
  @ApiOperation({
    summary: 'Update a workflow column',
    description:
      'Project-scoped action. Requires taskManagement.update through the caller\'s active project role. Updating orderIndex reorders sibling columns consistently.',
  })
  @ApiResponse({ status: 200, description: 'Workflow column updated' })
  @ResponseMessage(WORKFLOW_COLUMN_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({ action: 'update:workflow-column', resource: 'workflow-column', includeBody: true })
  updateWorkflowColumn(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body() dto: UpdateWorkflowColumnDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateWorkflowColumn(projectId, columnId, dto, user);
  }

  @Delete('columns/:columnId')
  @ApiOperation({
    summary: 'Delete a workflow column if it has no live tasks',
    description:
      'Project-scoped action. Requires taskManagement.delete through the caller\'s active project role. Locked default columns cannot be deleted, and deleting a custom column reindexes remaining columns.',
  })
  @ApiResponse({ status: 200, description: 'Workflow column deleted' })
  @ResponseMessage(WORKFLOW_COLUMN_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'delete')
  @LogActivity({ action: 'delete:workflow-column', resource: 'workflow-column' })
  deleteWorkflowColumn(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteWorkflowColumn(projectId, columnId, user);
  }
}
