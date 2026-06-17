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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
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
  ActivityScheduleFiltersDto,
  ActivityScheduleGanttQueryDto,
  ActivityScheduleImportDto,
  ActivityScheduleImportMode,
  BulkUpdateTasksDto,
  CreateProjectCalendarExceptionDto,
  CreateChecklistGroupDto,
  CreateTaskDto,
  MoveTaskDto,
  RecalculateActivityScheduleDto,
  TaskFiltersDto,
  UpdateActivityScheduleDto,
  UpdateProjectCalendarExceptionDto,
  UpdateChecklistGroupDto,
  UpdateChecklistItemDto,
  UpdateCommentDto,
  UpdateDependencyDto,
  UpsertProjectCalendarDto,
  UpdateTaskDto,
} from './dtos';
import {
  PROJECT_ACTIVITY_SCHEDULE_GANTT_FETCHED,
  PROJECT_ACTIVITY_SCHEDULE_CHECKS_FETCHED,
  PROJECT_ACTIVITY_SCHEDULE_EXPLANATION_FETCHED,
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
  TASK_DEPENDENCY_UPDATED,
  PROJECT_ACTIVITY_SCHEDULE_FETCHED,
  PROJECT_ACTIVITY_SCHEDULE_PROGRESS_FETCHED,
  PROJECT_ACTIVITY_SCHEDULE_SUMMARY_FETCHED,
  PROJECT_CALENDAR_EXCEPTION_CREATED,
  PROJECT_CALENDAR_EXCEPTION_DELETED,
  PROJECT_CALENDAR_EXCEPTION_UPDATED,
  PROJECT_CALENDAR_EXCEPTIONS_FETCHED,
  PROJECT_CALENDAR_FETCHED,
  PROJECT_CALENDAR_UPDATED,
  PROJECT_CRITICAL_PATH_FETCHED,
  TASK_FETCHED,
  TASK_LABEL_ADDED,
  TASK_LABEL_REMOVED,
  TASK_LABELS_FETCHED,
  TASK_ACTIVITY_FETCHED,
  TASK_ACTIVITY_SCHEDULE_IMPORTED,
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
  TASK_ACTIVITY_SCHEDULE_FETCHED,
  TASK_ACTIVITY_SCHEDULE_RECALCULATED,
  TASK_ACTIVITY_SCHEDULE_UPDATED,
} from './messages';
import { TasksService } from './tasks.service';
import type { ActivityScheduleUploadFile } from './services';

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
    return this.tasksService.getProjectTasks(
      projectId,
      filters,
      user,
      req.projectMembership,
    );
  }

  @Post('tasks')
  @ApiOperation({
    summary: 'Create a task in a project',
    description:
      "Project-scoped action. Requires taskManagement.create through the caller's active project role.",
  })
  @ApiResponse({ status: 201, description: 'Task created' })
  @ApiResponse({
    status: 400,
    description:
      'Validation error, invalid date range, invalid parent/assignee/dependency, or WIP limit exceeded',
  })
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
  @ApiResponse({
    status: 400,
    description:
      'Validation error, invalid date range, invalid parent task, or WIP limit exceeded',
  })
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

  @Get('activity-schedule')
  @ApiOperation({
    summary: 'List project activity schedule rows',
    description:
      'Returns scheduled project rows ordered by WBS. Can include phase/stage summary rows and critical-only filtering.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project activity schedule fetched',
  })
  @ResponseMessage(PROJECT_ACTIVITY_SCHEDULE_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectActivitySchedule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() filters: ActivityScheduleFiltersDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectActivitySchedule(
      projectId,
      filters,
      user,
    );
  }

  @Get('activity-schedule/critical-path')
  @ApiOperation({
    summary: 'List project critical path rows',
    description:
      'Returns activity schedule rows marked critical, ordered by WBS.',
  })
  @ApiResponse({ status: 200, description: 'Project critical path fetched' })
  @ResponseMessage(PROJECT_CRITICAL_PATH_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectCriticalPath(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() filters: ActivityScheduleFiltersDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectCriticalPath(projectId, filters, user);
  }

  @Get('activity-schedule/gantt')
  @ApiOperation({
    summary: 'Get precomputed Gantt rows and weekly buckets',
    description:
      'Returns WBS-ordered rows, summary counters, visible weeks, and per-week status buckets for rendering the Excel-style Gantt sheet.',
  })
  @ApiResponse({ status: 200, description: 'Project Gantt fetched' })
  @ResponseMessage(PROJECT_ACTIVITY_SCHEDULE_GANTT_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectActivityScheduleGantt(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() filters: ActivityScheduleGanttQueryDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectActivityScheduleGantt(
      projectId,
      filters,
      user,
    );
  }

  @Get('activity-schedule/progress-tracker')
  @ApiOperation({
    summary: 'Get activity schedule progress tracker rows',
    description:
      'Returns Excel Progress Tracker-style started/done/status rows from task and schedule execution fields.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project progress tracker fetched',
  })
  @ResponseMessage(PROJECT_ACTIVITY_SCHEDULE_PROGRESS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectActivityScheduleProgressTracker(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectActivityScheduleProgressTracker(
      projectId,
      user,
    );
  }

  @Get('activity-schedule/summary')
  @ApiOperation({
    summary: 'Get activity schedule summary counters',
    description:
      'Returns started, complete, overdue, activity count, and average progress counters for the Gantt header.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project activity schedule summary fetched',
  })
  @ResponseMessage(PROJECT_ACTIVITY_SCHEDULE_SUMMARY_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectActivityScheduleSummary(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectActivityScheduleSummary(projectId, user);
  }

  @Get('activity-schedule/checks')
  @ApiOperation({
    summary: 'Get activity schedule validation checks',
    description:
      'Returns project-wide schedule health checks including duplicate WBS, missing schedule rows, cycles, negative float, manual schedule issues, milestones, and calendar warnings.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project activity schedule checks fetched',
  })
  @ResponseMessage(PROJECT_ACTIVITY_SCHEDULE_CHECKS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectActivityScheduleChecks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectActivityScheduleChecks(projectId, user);
  }

  @Get('activity-schedule/explanations/:taskId')
  @ApiOperation({
    summary: 'Get latest CPM explanation for a task',
    description:
      'Returns the latest stored schedule explanation for why a task is critical or which predecessors/successors drove its dates.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project activity schedule explanation fetched',
  })
  @ResponseMessage(PROJECT_ACTIVITY_SCHEDULE_EXPLANATION_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectActivityScheduleExplanation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectActivityScheduleExplanation(
      projectId,
      taskId,
      user,
    );
  }

  @Get('activity-schedule/calendar')
  @ApiOperation({ summary: 'Get project activity schedule calendar' })
  @ApiResponse({ status: 200, description: 'Project calendar fetched' })
  @ResponseMessage(PROJECT_CALENDAR_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getProjectCalendar(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getProjectCalendar(projectId, user);
  }

  @Patch('activity-schedule/calendar')
  @ApiOperation({
    summary: 'Create or update project activity schedule calendar',
  })
  @ApiResponse({ status: 200, description: 'Project calendar updated' })
  @ResponseMessage(PROJECT_CALENDAR_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'upsert:activity-schedule-calendar',
    resource: 'activity-schedule-calendar',
    includeBody: true,
  })
  upsertProjectCalendar(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpsertProjectCalendarDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.upsertProjectCalendar(projectId, dto, user);
  }

  @Get('activity-schedule/calendar/exceptions')
  @ApiOperation({ summary: 'List project calendar exceptions' })
  @ApiResponse({
    status: 200,
    description: 'Project calendar exceptions fetched',
  })
  @ResponseMessage(PROJECT_CALENDAR_EXCEPTIONS_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  listProjectCalendarExceptions(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.listProjectCalendarExceptions(projectId, user);
  }

  @Post('activity-schedule/calendar/exceptions')
  @ApiOperation({ summary: 'Create project calendar exception' })
  @ApiResponse({
    status: 201,
    description: 'Project calendar exception created',
  })
  @ResponseMessage(PROJECT_CALENDAR_EXCEPTION_CREATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'create:activity-schedule-calendar-exception',
    resource: 'activity-schedule-calendar-exception',
    includeBody: true,
  })
  createProjectCalendarException(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectCalendarExceptionDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.createProjectCalendarException(
      projectId,
      dto,
      user,
    );
  }

  @Patch('activity-schedule/calendar/exceptions/:exceptionId')
  @ApiOperation({ summary: 'Update project calendar exception' })
  @ApiResponse({
    status: 200,
    description: 'Project calendar exception updated',
  })
  @ResponseMessage(PROJECT_CALENDAR_EXCEPTION_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'update:activity-schedule-calendar-exception',
    resource: 'activity-schedule-calendar-exception',
    includeBody: true,
  })
  updateProjectCalendarException(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
    @Body() dto: UpdateProjectCalendarExceptionDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateProjectCalendarException(
      projectId,
      exceptionId,
      dto,
      user,
    );
  }

  @Delete('activity-schedule/calendar/exceptions/:exceptionId')
  @ApiOperation({ summary: 'Delete project calendar exception' })
  @ApiResponse({
    status: 200,
    description: 'Project calendar exception deleted',
  })
  @ResponseMessage(PROJECT_CALENDAR_EXCEPTION_DELETED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'delete:activity-schedule-calendar-exception',
    resource: 'activity-schedule-calendar-exception',
  })
  deleteProjectCalendarException(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.deleteProjectCalendarException(
      projectId,
      exceptionId,
      user,
    );
  }

  @Post('activity-schedule/recalculate')
  @ApiOperation({
    summary: 'Recalculate project activity schedule CPM fields',
    description:
      'Computes and persists ES, EF, LS, LF, total float, free float, and critical path for all scheduled project tasks.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project activity schedule recalculated',
  })
  @ResponseMessage(TASK_ACTIVITY_SCHEDULE_RECALCULATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'recalculate:activity-schedule',
    resource: 'activity-schedule',
    includeBody: true,
  })
  recalculateActivitySchedule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: RecalculateActivityScheduleDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.recalculateActivitySchedule(projectId, dto, user);
  }

  @Post('activity-schedule/import')
  @ApiOperation({
    summary: 'Validate or import Excel tasks by WBS',
    description:
      'Accepts Activity schedule.xlsx-style workbooks and WBS.xlsx-style hierarchy workbooks. WBS imports create/update Phase -> Stage -> Activity -> Task hierarchy by WBS code. validateOnly reports issues without writes; upsertByWbs writes only after validation passes.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: Object.values(ActivityScheduleImportMode),
          default: ActivityScheduleImportMode.VALIDATE_ONLY,
        },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Activity schedule import processed',
  })
  @ResponseMessage(TASK_ACTIVITY_SCHEDULE_IMPORTED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @UseInterceptors(FileInterceptor('file'))
  @LogActivity({
    action: 'import:activity-schedule',
    resource: 'activity-schedule',
    includeBody: true,
  })
  importActivitySchedule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFile() file: ActivityScheduleUploadFile,
    @Body() dto: ActivityScheduleImportDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.importActivitySchedule(projectId, file, dto, user);
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
    return this.tasksService.getTask(
      projectId,
      taskId,
      user,
      req.projectMembership,
    );
  }

  @Get('tasks/:taskId/activity-schedule')
  @ApiOperation({ summary: 'Get task activity schedule fields' })
  @ApiResponse({ status: 200, description: 'Task activity schedule fetched' })
  @ResponseMessage(TASK_ACTIVITY_SCHEDULE_FETCHED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'view')
  getTaskActivitySchedule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskActivitySchedule(projectId, taskId, user);
  }

  @Patch('tasks/:taskId/activity-schedule')
  @ApiOperation({
    summary: 'Create or update task activity schedule fields',
    description:
      'Upserts duration, planned dates, actual dates, manual scheduling flag, and manual override reason for the task activity schedule.',
  })
  @ApiResponse({ status: 200, description: 'Task activity schedule updated' })
  @ResponseMessage(TASK_ACTIVITY_SCHEDULE_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'update:task-activity-schedule',
    resource: 'task-activity-schedule',
    includeBody: true,
  })
  updateTaskActivitySchedule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateActivityScheduleDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateTaskActivitySchedule(
      projectId,
      taskId,
      dto,
      user,
    );
  }

  @Patch('tasks/:taskId')
  @ApiOperation({
    summary: 'Update a task',
    description:
      "Project-scoped action. Requires taskManagement.update through the caller's active project role. Supports timeline edits for startDate, endDate, progress, dependencyIds, and optional viewMeta.gantt updates.",
  })
  @ApiResponse({ status: 200, description: 'Task updated' })
  @ApiResponse({
    status: 400,
    description:
      'Validation error, invalid date range, cycle in dependencies, or WIP limit exceeded',
  })
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
  @ApiResponse({
    status: 400,
    description:
      'Dependency creates a cycle, references a task outside the project, or is already registered',
  })
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

  @Patch('tasks/:taskId/dependencies/:depId')
  @ApiOperation({ summary: 'Update a task dependency type or lag' })
  @ApiResponse({ status: 200, description: 'Task dependency updated' })
  @ApiResponse({
    status: 400,
    description:
      'Dependency update creates a cycle, references a task outside the project, or duplicates an existing edge',
  })
  @ApiResponse({ status: 404, description: 'Dependency not found' })
  @ResponseMessage(TASK_DEPENDENCY_UPDATED)
  @UseGuards(ProjectPermissionGuard)
  @RequireProjectPermission('taskManagement', 'update')
  @LogActivity({
    action: 'update:task-dependency',
    resource: 'task-dependency',
    includeBody: true,
  })
  updateTaskDependency(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('depId', ParseUUIDPipe) depId: string,
    @Body() dto: UpdateDependencyDto,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.updateTaskDependency(
      projectId,
      taskId,
      depId,
      dto,
      user,
    );
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
  @ApiOperation({
    summary: 'Delete a checklist group (items become ungrouped)',
  })
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
  @ApiResponse({
    status: 400,
    description: 'Label does not belong to this project, or is already applied',
  })
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
  @ApiResponse({
    status: 400,
    description:
      'User is not a project member, or is already watching this task',
  })
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
  @ApiResponse({
    status: 400,
    description:
      'Self-relation, related task outside this project, or relation already exists',
  })
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
  @ApiResponse({
    status: 200,
    description: 'Paginated list of task activity events',
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  getTaskActivity(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @GetUser() user: RequestUser,
  ) {
    return this.tasksService.getTaskActivity(
      projectId,
      taskId,
      user,
      page,
      limit,
    );
  }
}
