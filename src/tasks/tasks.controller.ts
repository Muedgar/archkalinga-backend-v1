import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { GetUser, RequireProjectPermission } from 'src/auth/decorators';
import { JwtAuthGuard, ProjectPermissionGuard } from 'src/auth/guards';
import type { RequestUser } from 'src/auth/types';
import { LogActivity, ResponseMessage } from 'src/common/decorators';
import {
  AddChecklistItemDto,
  AddCommentDto,
  AddDependencyDto,
  AddLabelDto,
  AddRelationDto,
  AddWatcherDto,
  BulkUpdateTasksDto,
  CreateChecklistGroupDto,
  CreateTaskDto,
  MoveTaskDto,
  TaskFiltersDto,
  UpdateChecklistGroupDto,
  UpdateChecklistItemDto,
  UpdateCommentDto,
  UpdateTaskDto,
} from './dtos';
import {
  TASK_CHECKLIST_FETCHED,
  TASK_CHECKLIST_GROUP_CREATED,
  TASK_CHECKLIST_GROUP_DELETED,
  TASK_CHECKLIST_GROUP_UPDATED,
  TASK_CHECKLIST_GROUPS_FETCHED,
  TASK_CHECKLIST_ITEM_ADDED,
  TASK_CHECKLIST_ITEM_DELETED,
  TASK_CHECKLIST_ITEM_UPDATED,
  TASK_COMMENT_ADDED,
  TASK_COMMENT_DELETED,
  TASK_COMMENT_UPDATED,
  TASK_COMMENTS_FETCHED,
  TASK_CREATED,
  TASK_DELETED,
  TASK_DEPENDENCIES_FETCHED,
  TASK_DEPENDENCY_ADDED,
  TASK_DEPENDENCY_DELETED,
  TASK_FETCHED,
  TASK_LABEL_ADDED,
  TASK_LABEL_REMOVED,
  TASK_LABELS_FETCHED,
  TASK_ACTIVITY_FETCHED,
  TASK_MOVED,
  TASK_RELATION_ADDED,
  TASK_RELATION_DELETED,
  TASK_RELATIONS_FETCHED,
  TASK_UPDATED,
  TASK_WATCHER_ADDED,
  TASK_WATCHER_REMOVED,
  TASK_WATCHERS_FETCHED,
  TASKS_BULK_UPDATED,
  TASKS_FETCHED,
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
      "Project-scoped action. Requires taskManagement.view through the caller's active project role.",
  })
  @ApiResponse({ status: 200, description: 'Tasks fetched' })
  @ResponseMessage(TASKS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectTasks(
    @Req() req: any,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() filters: TaskFiltersDto,
    @GetUser() user: RequestUser,
  ) {
    // Pass the membership already loaded by ProjectPermissionGuard so the service
    // can skip a redundant verifyProjectPermission call (saves 2 DB queries per request).
    return this.tasksService.getProjectTasks(projectId, filters, user, req.projectMembership);
  }

  @Post('tasks')
  @ApiOperation({
    summary: 'Create a task in a project',
    description:
      "Project-scoped action. Requires taskManagement.create through the caller's active project role.",
  })
  @ApiResponse({ status: 201, description: 'Task created' })
  @ApiResponse({ status: 400, description: 'Validation error, invalid date range, invalid parent/assignee/dependency, or WIP limit exceeded' })
  @ApiResponse({ status: 403, description: 'Insufficient project permission' })
  @ApiResponse({ status: 404, description: 'Project not found' })
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
      "Project-scoped action. Requires taskManagement.update through the caller's active project role. Supports Gantt-oriented bulk edits for status, progress, dates, positioning, and optional viewMeta updates.",
  })
  @ApiResponse({ status: 200, description: 'Tasks updated' })
  @ApiResponse({ status: 400, description: 'Validation error, invalid date range, invalid parent task, or WIP limit exceeded' })
  @ApiResponse({ status: 403, description: 'Insufficient project permission' })
  @ResponseMessage(TASKS_BULK_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'bulk-update:task',
    resource: 'task',
    includeBody: true,
  })
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
      "Project-scoped action. Requires taskManagement.view through the caller's active project role.",
  })
  @ApiResponse({ status: 200, description: 'Task fetched' })
  @ResponseMessage(TASK_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTask(
    @Req() req: any,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    // Pass the membership already loaded by ProjectPermissionGuard so the service
    // skips an otherwise redundant DB query for the same row.
    return this.tasksService.getTask(projectId, taskId, user, req.projectMembership);
  }

  @Patch('tasks/:taskId')
  @ApiOperation({
    summary: 'Update a task',
    description:
      "Project-scoped action. Requires taskManagement.update through the caller's active project role. Supports timeline edits for startDate, endDate, progress, dependencyIds, and optional viewMeta.gantt updates.",
  })
  @ApiResponse({ status: 200, description: 'Task updated' })
  @ApiResponse({ status: 400, description: 'Validation error, invalid date range, cycle in dependencies, or WIP limit exceeded' })
  @ApiResponse({ status: 403, description: 'Insufficient project permission' })
  @ApiResponse({ status: 404, description: 'Task or project not found' })
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

  @Patch('tasks/:taskId/move')
  @ApiOperation({
    summary: 'Move or reorder a task',
    description:
      "Project-scoped action. Requires taskManagement.update through the caller's active project role. Supports drag-and-drop across workflow columns, sibling reordering, and subtask reparenting.",
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
      "Project-scoped action. Requires taskManagement.delete through the caller's active project role. Soft-deletes the selected task and its descendant subtasks, then returns delete summary metadata for the frontend.",
  })
  @ApiResponse({ status: 200, description: 'Task deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient project permission' })
  @ApiResponse({ status: 404, description: 'Task or project not found' })
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
  @LogActivity({
    action: 'create:task-comment',
    resource: 'task-comment',
    includeBody: true,
  })
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
  @LogActivity({
    action: 'update:task-comment',
    resource: 'task-comment',
    includeBody: true,
  })
  updateTaskComment(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateTaskComment(
      projectId,
      taskId,
      commentId,
      dto,
      user,
    );
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
    return this.tasksService.deleteTaskComment(
      projectId,
      taskId,
      commentId,
      user,
    );
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
  @LogActivity({
    action: 'create:task-checklist-item',
    resource: 'task-checklist-item',
    includeBody: true,
  })
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
  @LogActivity({
    action: 'update:task-checklist-item',
    resource: 'task-checklist-item',
    includeBody: true,
  })
  updateChecklistItem(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateChecklistItem(
      projectId,
      taskId,
      itemId,
      dto,
      user,
    );
  }

  @Delete('tasks/:taskId/checklist/:itemId')
  @ApiOperation({ summary: 'Delete a task checklist item' })
  @ApiResponse({ status: 200, description: 'Checklist item deleted' })
  @ResponseMessage(TASK_CHECKLIST_ITEM_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'delete:task-checklist-item',
    resource: 'task-checklist-item',
  })
  deleteChecklistItem(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('itemId') itemId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteChecklistItem(
      projectId,
      taskId,
      itemId,
      user,
    );
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
  @ApiResponse({ status: 400, description: 'Dependency creates a cycle, references a task outside the project, or is already registered' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ResponseMessage(TASK_DEPENDENCY_ADDED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'create:task-dependency',
    resource: 'task-dependency',
    includeBody: true,
  })
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
  @LogActivity({
    action: 'delete:task-dependency',
    resource: 'task-dependency',
  })
  deleteTaskDependency(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('depId', ParseUUIDPipe) depId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteTaskDependency(
      projectId,
      taskId,
      depId,
      user,
    );
  }

  // ── Checklist Groups ────────────────────────────────────────────────────────

  @Get('tasks/:taskId/checklist-groups')
  @ApiOperation({ summary: 'List checklist groups for a task' })
  @ApiResponse({ status: 200, description: 'Task checklist groups fetched' })
  @ResponseMessage(TASK_CHECKLIST_GROUPS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getChecklistGroups(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getChecklistGroups(projectId, taskId, user);
  }

  @Post('tasks/:taskId/checklist-groups')
  @ApiOperation({ summary: 'Create a checklist group on a task' })
  @ApiResponse({ status: 201, description: 'Task checklist group created' })
  @ResponseMessage(TASK_CHECKLIST_GROUP_CREATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'create:task-checklist-group',
    resource: 'task-checklist-group',
    includeBody: true,
  })
  createChecklistGroup(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateChecklistGroupDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.createChecklistGroup(projectId, taskId, dto, user);
  }

  @Patch('tasks/:taskId/checklist-groups/:groupId')
  @ApiOperation({ summary: 'Update a checklist group' })
  @ApiResponse({ status: 200, description: 'Task checklist group updated' })
  @ResponseMessage(TASK_CHECKLIST_GROUP_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'update:task-checklist-group',
    resource: 'task-checklist-group',
    includeBody: true,
  })
  updateChecklistGroup(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateChecklistGroupDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateChecklistGroup(
      projectId,
      taskId,
      groupId,
      dto,
      user,
    );
  }

  @Delete('tasks/:taskId/checklist-groups/:groupId')
  @ApiOperation({ summary: 'Delete a checklist group (items become ungrouped)' })
  @ApiResponse({ status: 200, description: 'Task checklist group deleted' })
  @ResponseMessage(TASK_CHECKLIST_GROUP_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'delete:task-checklist-group',
    resource: 'task-checklist-group',
  })
  deleteChecklistGroup(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteChecklistGroup(
      projectId,
      taskId,
      groupId,
      user,
    );
  }

  // ── Labels ──────────────────────────────────────────────────────────────────

  @Get('tasks/:taskId/labels')
  @ApiOperation({ summary: 'List labels applied to a task' })
  @ApiResponse({ status: 200, description: 'Task labels fetched' })
  @ResponseMessage(TASK_LABELS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTaskLabels(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskLabels(projectId, taskId, user);
  }

  @Post('tasks/:taskId/labels')
  @ApiOperation({ summary: 'Add a label to a task' })
  @ApiResponse({ status: 201, description: 'Task label added' })
  @ApiResponse({ status: 400, description: 'Label does not belong to this project, or is already applied' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ResponseMessage(TASK_LABEL_ADDED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'add:task-label',
    resource: 'task-label',
    includeBody: true,
  })
  addTaskLabel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddLabelDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.addTaskLabel(projectId, taskId, dto, user);
  }

  @Delete('tasks/:taskId/labels/:taskLabelId')
  @ApiOperation({ summary: 'Remove a label from a task' })
  @ApiResponse({ status: 200, description: 'Task label removed' })
  @ResponseMessage(TASK_LABEL_REMOVED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'remove:task-label',
    resource: 'task-label',
  })
  removeTaskLabel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('taskLabelId', ParseUUIDPipe) taskLabelId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.removeTaskLabel(
      projectId,
      taskId,
      taskLabelId,
      user,
    );
  }

  // ── Watchers ────────────────────────────────────────────────────────────────

  @Get('tasks/:taskId/watchers')
  @ApiOperation({ summary: 'List watchers of a task' })
  @ApiResponse({ status: 200, description: 'Task watchers fetched' })
  @ResponseMessage(TASK_WATCHERS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTaskWatchers(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskWatchers(projectId, taskId, user);
  }

  @Post('tasks/:taskId/watchers')
  @ApiOperation({ summary: 'Add a watcher to a task' })
  @ApiResponse({ status: 201, description: 'Task watcher added' })
  @ApiResponse({ status: 400, description: 'User is not a project member, or is already watching this task' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ResponseMessage(TASK_WATCHER_ADDED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'add:task-watcher',
    resource: 'task-watcher',
    includeBody: true,
  })
  addTaskWatcher(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddWatcherDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.addTaskWatcher(projectId, taskId, dto, user);
  }

  @Delete('tasks/:taskId/watchers/:watcherId')
  @ApiOperation({ summary: 'Remove a watcher from a task' })
  @ApiResponse({ status: 200, description: 'Task watcher removed' })
  @ResponseMessage(TASK_WATCHER_REMOVED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'remove:task-watcher',
    resource: 'task-watcher',
  })
  removeTaskWatcher(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('watcherId', ParseUUIDPipe) watcherId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.removeTaskWatcher(
      projectId,
      taskId,
      watcherId,
      user,
    );
  }

  // ── Relations ───────────────────────────────────────────────────────────────

  @Get('tasks/:taskId/relations')
  @ApiOperation({ summary: 'List relations of a task (both directions)' })
  @ApiResponse({ status: 200, description: 'Task relations fetched' })
  @ResponseMessage(TASK_RELATIONS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTaskRelations(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskRelations(projectId, taskId, user);
  }

  @Post('tasks/:taskId/relations')
  @ApiOperation({ summary: 'Add a relation between tasks' })
  @ApiResponse({ status: 201, description: 'Task relation added' })
  @ApiResponse({ status: 400, description: 'Self-relation, related task outside this project, or relation already exists' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ResponseMessage(TASK_RELATION_ADDED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'add:task-relation',
    resource: 'task-relation',
    includeBody: true,
  })
  addTaskRelation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AddRelationDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.addTaskRelation(projectId, taskId, dto, user);
  }

  @Delete('tasks/:taskId/relations/:relationId')
  @ApiOperation({ summary: 'Delete a task relation' })
  @ApiResponse({ status: 200, description: 'Task relation deleted' })
  @ResponseMessage(TASK_RELATION_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'delete:task-relation',
    resource: 'task-relation',
  })
  deleteTaskRelation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteTaskRelation(
      projectId,
      taskId,
      relationId,
      user,
    );
  }

  // ── Activity log ────────────────────────────────────────────────────────────

  @Get('tasks/:taskId/activity')
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  @ResponseMessage(TASK_ACTIVITY_FETCHED)
  @ApiOperation({ summary: 'Get activity log for a task (newest first)' })
  @ApiResponse({ status: 200, description: 'Paginated list of task activity events' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  getTaskActivity(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskActivity(projectId, taskId, user, page, limit);
  }

}

