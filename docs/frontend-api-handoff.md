# Frontend API Handoff

This handoff is based only on backend APIs that currently exist and are exposed through Swagger-decorated controllers.

## RTK Query Endpoint Definitions

```ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as { auth?: { token?: string } }).auth?.token;
      if (token) headers.set('authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  tagTypes: [
    'Template',
    'Project',
    'ProjectInvite',
    'Task',
    'TaskChecklist',
    'TaskComment',
    'TaskDependency',
    'WorkflowColumn',
  ],
  endpoints: (builder) => ({
    getTemplates: builder.query<PaginatedResponse<Template>, ListQuery | void>({
      query: (params) => ({ url: '/templates', params }),
      providesTags: ['Template'],
    }),
    getTemplate: builder.query<Template, string>({
      query: (identifier) => `/templates/${identifier}`,
      providesTags: (_result, _error, identifier) => [
        { type: 'Template', id: identifier },
      ],
    }),
    createTemplate: builder.mutation<ApiEnvelope<Template>, CreateTemplateBody>(
      {
        query: (body) => ({ url: '/templates', method: 'POST', body }),
        invalidatesTags: ['Template'],
      },
    ),
    updateTemplate: builder.mutation<
      ApiEnvelope<Template>,
      { identifier: string; body: UpdateTemplateBody }
    >({
      query: ({ identifier, body }) => ({
        url: `/templates/${identifier}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { identifier }) => [
        'Template',
        { type: 'Template', id: identifier },
      ],
    }),
    deleteTemplate: builder.mutation<ApiEnvelope<{ id: string }>, string>({
      query: (identifier) => ({
        url: `/templates/${identifier}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Template'],
    }),

    getProjects: builder.query<
      PaginatedResponse<ProjectListItem>,
      ListQuery | void
    >({
      query: (params) => ({ url: '/projects', params }),
      providesTags: ['Project'],
    }),
    getProject: builder.query<ProjectDetail, string>({
      query: (projectId) => `/projects/${projectId}`,
      providesTags: (_result, _error, projectId) => [
        { type: 'Project', id: projectId },
      ],
    }),
    createProject: builder.mutation<
      ApiEnvelope<ProjectDetail>,
      CreateProjectBody
    >({
      query: (body) => ({ url: '/projects', method: 'POST', body }),
      invalidatesTags: ['Project'],
    }),
    updateProject: builder.mutation<
      ApiEnvelope<ProjectDetail>,
      { projectId: string; body: UpdateProjectBody }
    >({
      query: ({ projectId, body }) => ({
        url: `/projects/${projectId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        'Project',
        { type: 'Project', id: projectId },
      ],
    }),
    deleteProject: builder.mutation<ApiEnvelope<{ id: string }>, string>({
      query: (projectId) => ({
        url: `/projects/${projectId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, projectId) => [
        'Project',
        { type: 'Project', id: projectId },
      ],
    }),

    listProjectInvites: builder.query<
      PaginatedResponse<ProjectInvite>,
      { projectId: string } & InviteListQuery
    >({
      query: ({ projectId, ...params }) => ({
        url: `/projects/${projectId}/invites`,
        params,
      }),
      providesTags: (_result, _error, { projectId }) => [
        'ProjectInvite',
        { type: 'Project', id: projectId },
      ],
    }),
    createProjectInvite: builder.mutation<
      ApiEnvelope<ProjectInvite>,
      CreateProjectInviteBody
    >({
      query: (body) => ({ url: '/project-invites', method: 'POST', body }),
      invalidatesTags: (_result, _error, body) => [
        'ProjectInvite',
        { type: 'Project', id: body.projectId },
      ],
    }),
    resendProjectInvite: builder.mutation<
      ApiEnvelope<ProjectInvite>,
      { inviteId: string; projectId: string }
    >({
      query: ({ inviteId }) => ({
        url: `/project-invites/${inviteId}/resend`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        'ProjectInvite',
        { type: 'Project', id: projectId },
      ],
    }),
    cancelProjectInvite: builder.mutation<
      ApiEnvelope<ProjectInvite>,
      { inviteId: string; projectId: string }
    >({
      query: ({ inviteId }) => ({
        url: `/project-invites/${inviteId}/cancel`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        'ProjectInvite',
        { type: 'Project', id: projectId },
      ],
    }),
    acceptProjectInvite: builder.mutation<
      ApiEnvelope<AcceptInviteResponse>,
      string
    >({
      query: (token) => ({
        url: '/project-invites/accept',
        method: 'POST',
        params: { token },
      }),
      invalidatesTags: ['Project', 'ProjectInvite'],
    }),

    getProjectTasks: builder.query<
      PaginatedResponse<TaskItem> & {
        meta: { projectId: string; flat: boolean };
      },
      { projectId: string } & TaskQuery
    >({
      query: ({ projectId, ...params }) => ({
        url: `/projects/${projectId}/tasks`,
        params,
      }),
      providesTags: (_result, _error, { projectId }) => [
        'Task',
        { type: 'Project', id: projectId },
      ],
    }),
    getTask: builder.query<TaskItem, { projectId: string; taskId: string }>({
      query: ({ projectId, taskId }) =>
        `/projects/${projectId}/tasks/${taskId}`,
      providesTags: (_result, _error, { taskId }) => [
        { type: 'Task', id: taskId },
      ],
    }),
    createTask: builder.mutation<
      ApiEnvelope<TaskItem>,
      { projectId: string; body: CreateTaskBody }
    >({
      query: ({ projectId, body }) => ({
        url: `/projects/${projectId}/tasks`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        'Task',
        'WorkflowColumn',
        { type: 'Project', id: projectId },
      ],
    }),
    updateTask: builder.mutation<
      ApiEnvelope<TaskItem>,
      { projectId: string; taskId: string; body: UpdateTaskBody }
    >({
      query: ({ projectId, taskId, body }) => ({
        url: `/projects/${projectId}/tasks/${taskId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { projectId, taskId }) => [
        'Task',
        { type: 'Task', id: taskId },
        { type: 'Project', id: projectId },
      ],
    }),
    bulkUpdateTasks: builder.mutation<
      ApiEnvelope<TaskItem[]>,
      { projectId: string; body: BulkUpdateTasksBody }
    >({
      query: ({ projectId, body }) => ({
        url: `/projects/${projectId}/tasks/bulk`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        'Task',
        { type: 'Project', id: projectId },
      ],
    }),
    moveTask: builder.mutation<
      ApiEnvelope<TaskItem>,
      { projectId: string; taskId: string; body: MoveTaskBody }
    >({
      query: ({ projectId, taskId, body }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/position`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { projectId, taskId }) => [
        'Task',
        'WorkflowColumn',
        { type: 'Task', id: taskId },
        { type: 'Project', id: projectId },
      ],
    }),
    deleteTask: builder.mutation<
      ApiEnvelope<DeleteTaskResponse>,
      { projectId: string; taskId: string }
    >({
      query: ({ projectId, taskId }) => ({
        url: `/projects/${projectId}/tasks/${taskId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId, taskId }) => [
        'Task',
        'WorkflowColumn',
        { type: 'Task', id: taskId },
        { type: 'Project', id: projectId },
      ],
    }),

    getTaskChecklist: builder.query<
      TaskChecklistItem[],
      { projectId: string; taskId: string }
    >({
      query: ({ projectId, taskId }) =>
        `/projects/${projectId}/tasks/${taskId}/checklist`,
      providesTags: (_result, _error, { taskId }) => [
        { type: 'TaskChecklist', id: taskId },
      ],
    }),
    addChecklistItem: builder.mutation<
      ApiEnvelope<TaskChecklistItem>,
      { projectId: string; taskId: string; body: AddChecklistItemBody }
    >({
      query: ({ projectId, taskId, body }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/checklist`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'TaskChecklist', id: taskId },
        { type: 'Task', id: taskId },
      ],
    }),
    updateChecklistItem: builder.mutation<
      ApiEnvelope<TaskChecklistItem>,
      {
        projectId: string;
        taskId: string;
        itemId: string;
        body: UpdateChecklistItemBody;
      }
    >({
      query: ({ projectId, taskId, itemId, body }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/checklist/${itemId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'TaskChecklist', id: taskId },
        { type: 'Task', id: taskId },
      ],
    }),
    deleteChecklistItem: builder.mutation<
      ApiEnvelope<{ id: string; success: true }>,
      { projectId: string; taskId: string; itemId: string }
    >({
      query: ({ projectId, taskId, itemId }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/checklist/${itemId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'TaskChecklist', id: taskId },
        { type: 'Task', id: taskId },
      ],
    }),

    getTaskComments: builder.query<
      TaskComment[],
      { projectId: string; taskId: string }
    >({
      query: ({ projectId, taskId }) =>
        `/projects/${projectId}/tasks/${taskId}/comments`,
      providesTags: (_result, _error, { taskId }) => [
        { type: 'TaskComment', id: taskId },
      ],
    }),
    addTaskComment: builder.mutation<
      ApiEnvelope<TaskComment>,
      { projectId: string; taskId: string; body: AddCommentBody }
    >({
      query: ({ projectId, taskId, body }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/comments`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'TaskComment', id: taskId },
        { type: 'Task', id: taskId },
      ],
    }),
    updateTaskComment: builder.mutation<
      ApiEnvelope<TaskComment>,
      {
        projectId: string;
        taskId: string;
        commentId: string;
        body: UpdateCommentBody;
      }
    >({
      query: ({ projectId, taskId, commentId, body }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'TaskComment', id: taskId },
        { type: 'Task', id: taskId },
      ],
    }),
    deleteTaskComment: builder.mutation<
      ApiEnvelope<{ id: string; success: true }>,
      { projectId: string; taskId: string; commentId: string }
    >({
      query: ({ projectId, taskId, commentId }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/comments/${commentId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'TaskComment', id: taskId },
        { type: 'Task', id: taskId },
      ],
    }),

    getTaskDependencies: builder.query<
      TaskDependency[],
      { projectId: string; taskId: string }
    >({
      query: ({ projectId, taskId }) =>
        `/projects/${projectId}/tasks/${taskId}/dependencies`,
      providesTags: (_result, _error, { taskId }) => [
        { type: 'TaskDependency', id: taskId },
      ],
    }),
    addTaskDependency: builder.mutation<
      ApiEnvelope<TaskDependency>,
      { projectId: string; taskId: string; body: AddDependencyBody }
    >({
      query: ({ projectId, taskId, body }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/dependencies`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'TaskDependency', id: taskId },
        { type: 'Task', id: taskId },
      ],
    }),
    deleteTaskDependency: builder.mutation<
      ApiEnvelope<{ id: string; success: true }>,
      { projectId: string; taskId: string; depId: string }
    >({
      query: ({ projectId, taskId, depId }) => ({
        url: `/projects/${projectId}/tasks/${taskId}/dependencies/${depId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'TaskDependency', id: taskId },
        { type: 'Task', id: taskId },
      ],
    }),

    getWorkflowColumns: builder.query<WorkflowColumn[], { projectId: string }>({
      query: ({ projectId }) => `/projects/${projectId}/columns`,
      providesTags: (_result, _error, { projectId }) => [
        'WorkflowColumn',
        { type: 'Project', id: projectId },
      ],
    }),
    createWorkflowColumn: builder.mutation<
      ApiEnvelope<WorkflowColumn>,
      { projectId: string; body: CreateWorkflowColumnBody }
    >({
      query: ({ projectId, body }) => ({
        url: `/projects/${projectId}/columns`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        'WorkflowColumn',
        { type: 'Project', id: projectId },
      ],
    }),
    updateWorkflowColumn: builder.mutation<
      ApiEnvelope<WorkflowColumn>,
      { projectId: string; columnId: string; body: UpdateWorkflowColumnBody }
    >({
      query: ({ projectId, columnId, body }) => ({
        url: `/projects/${projectId}/columns/${columnId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        'WorkflowColumn',
        { type: 'Project', id: projectId },
      ],
    }),
    deleteWorkflowColumn: builder.mutation<
      ApiEnvelope<{ id: string; deleted: true }>,
      { projectId: string; columnId: string }
    >({
      query: ({ projectId, columnId }) => ({
        url: `/projects/${projectId}/columns/${columnId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        'WorkflowColumn',
        { type: 'Project', id: projectId },
      ],
    }),
  }),
});
```

## Plain TypeScript Interfaces

```ts
export type ApiEnvelope<T> = {
  message?: string;
  data: T;
};

export type PaginatedResponse<T> = {
  items: T[];
  count: number;
  pages: number;
  previousPage: number | null;
  page: number;
  nextPage: number | null;
  limit: number;
  meta?: Record<string, unknown>;
};

export type ListQuery = {
  page?: number;
  limit?: number;
  orderBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  search?: string;
};

export type ProjectPermissionMatrix = Record<string, Record<string, boolean>>;

export type ProjectRole = {
  id: string;
  name: string;
  slug: string;
  status: boolean;
  permissions: ProjectPermissionMatrix;
};

export type TemplateTask = {
  id: string;
  name: string;
  description: string | null;
  subtasks: TemplateTask[];
};

export type Template = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  tasks: TemplateTask[];
  createdAt: string;
  updatedAt: string;
};

export type CreateTemplateBody = {
  name: string;
  description?: string;
  isDefault?: boolean;
  tasks: Array<{
    name: string;
    description?: string;
    subtasks?: CreateTemplateBody['tasks'];
  }>;
};

export type UpdateTemplateBody = Partial<CreateTemplateBody>;

export type ProjectMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
  projectRoleId: string | null;
  projectRole: ProjectRole | null;
};

export type ProjectInvite = {
  id: string;
  inviteeEmail: string;
  projectRoleId: string;
  projectRole: ProjectRole | null;
  status: string;
  expiresAt: string;
};

export type ProjectContribution = {
  id: string;
  userId: string;
  taskId: string | null;
  actionType: string;
  createdAt: string;
  actorName: string | null;
};

export type ProjectListItem = {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  type: string;
  status: string;
  archivedAt: string | null;
  template: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  type: string;
  status: string;
  archivedAt: string | null;
  createdByUserId: string;
  template: {
    id: string;
    name: string;
    description: string;
    isDefault: boolean;
  };
  projectRoles: ProjectRole[];
  members: ProjectMember[];
  invites: ProjectInvite[];
  recentContributions: ProjectContribution[];
};

export type CreateProjectBody = {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string | null;
  type: 'ARCHITECTURE' | 'STRUCTURE' | 'MEP' | 'INTERIOR';
  templateId: string;
  memberIds?: string[];
};

export type UpdateProjectBody = Partial<CreateProjectBody> & {
  status?: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
};

export type CreateProjectInviteBody = {
  projectId: string;
  inviteeEmail: string;
  projectRoleId: string;
  taskId?: string;
  subtaskId?: string;
  message?: string;
  autoAssignOnAccept?: boolean;
};

export type InviteListQuery = {
  taskId?: string;
  subtaskId?: string;
  status?: string;
  page?: number;
  limit?: number;
};

export type AcceptInviteResponse = {
  inviteId: string;
  projectId: string;
  taskId: string | null;
  subtaskId: string | null;
  membership: {
    id: string;
    status: string;
    projectRoleId: string;
    projectRole: ProjectRole | null;
  };
};

export type TaskAssignedMember = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  title: string | null;
  projectRoleId: string | null;
  projectRole: ProjectRole | null;
  assignmentRole: string | null;
};

export type TaskReportee = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  title: string | null;
  projectRoleId: string | null;
  projectRole: ProjectRole | null;
};

export type TaskChecklistItem = {
  id: string;
  text: string;
  completed: boolean;
  orderIndex: number;
  completedByUserId: string | null;
  completedAt: string | null;
};

export type TaskComment = {
  id: string;
  taskId: string;
  authorUserId: string;
  body: string;
  parentCommentId: string | null;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    title: string | null;
  } | null;
};

export type TaskDependency = {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  dependencyType: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number | null;
  dependsOnTask: {
    id: string;
    title: string | null;
    status: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
};

export type TaskItem = {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  workflowColumnId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  startDate: string | null;
  endDate: string | null;
  progress: number | null;
  completed: boolean;
  rank: string | null;
  createdByUserId: string;
  assignedMembers: TaskAssignedMember[];
  reportee: TaskReportee | null;
  checklistItems: TaskChecklistItem[];
  comments: TaskComment[];
  dependencies: TaskDependency[];
  viewMeta: Record<string, unknown>;
  childCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskMemberRef = {
  userId: string;
  projectRoleId: string;
};

export type TaskReporteeRef = {
  userId: string;
  projectRoleId: string;
};

export type CreateTaskBody = {
  parentTaskId?: string | null;
  title: string;
  description?: string;
  status?: string;
  workflowColumnId?: string;
  priority?: string | null;
  startDate?: string;
  endDate?: string;
  progress?: number | null;
  assignedMembers: TaskMemberRef[];
  reportee: TaskReporteeRef;
  checklistItems?: Array<{ text: string; orderIndex: number }>;
  dependencyIds?: string[];
  viewMeta?: {
    mindmap?: { x?: number; y?: number; collapsed?: boolean };
    gantt?: { barColor?: string };
  };
};

export type UpdateTaskBody = Partial<Omit<CreateTaskBody, 'parentTaskId'>>;

export type BulkUpdateTasksBody = {
  items: Array<{
    taskId: string;
    status?: string;
    progress?: number;
    startDate?: string | null;
    endDate?: string | null;
    parentTaskId?: string | null;
    workflowColumnId?: string | null;
    viewMeta?: {
      mindmap?: { x?: number; y?: number; collapsed?: boolean };
      gantt?: { barColor?: string };
    };
  }>;
};

export type MoveTaskBody = {
  parentTaskId?: string | null;
  workflowColumnId?: string | null;
  beforeTaskId?: string;
  afterTaskId?: string;
};

export type DeleteTaskResponse = {
  id: string;
  success: true;
  deletedTaskCount: number;
};

export type AddChecklistItemBody = {
  text: string;
  orderIndex: number;
};

export type UpdateChecklistItemBody = {
  text?: string;
  completed?: boolean;
  orderIndex?: number;
};

export type AddCommentBody = {
  body: string;
  parentCommentId?: string;
};

export type UpdateCommentBody = {
  body?: string;
};

export type AddDependencyBody = {
  dependsOnTaskId: string;
  dependencyType?: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays?: number;
};

export type WorkflowColumn = {
  id: string;
  projectId: string;
  name: string;
  statusKey: string | null;
  orderIndex: number;
  wipLimit: number | null;
  locked: boolean;
  taskCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkflowColumnBody = {
  name: string;
  statusKey?: string | null;
  orderIndex?: number;
  wipLimit?: number | null;
};

export type UpdateWorkflowColumnBody = Partial<CreateWorkflowColumnBody>;

export type TaskQuery = {
  page?: number;
  limit?: number;
  orderBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  search?: string;
  parentTaskId?: string | 'root';
  status?: string;
  priority?: string;
  assignedUserId?: string;
  reporteeUserId?: string;
  projectRoleId?: string;
  workflowColumnId?: string;
  includeDeleted?: boolean;
  include?: string;
  flat?: boolean;
  startDateFrom?: string;
  startDateTo?: string;
  endDateFrom?: string;
  endDateTo?: string;
  hasIncompleteChecklist?: boolean;
};
```

## Frontend Migration Checklist By Screen / Module

### Project Detail

- Replace any `memberIds`-driven rendering with `members[]`.
- Use `members[].projectRole` for badges, permissions, and pickers.
- Use `projectRoles[]` for invite-role selectors and role chips.

### Project Create / Edit

- Keep using `memberIds` in request payloads for project create/update.
- Do not expect `memberIds` in project read responses.
- Treat `templateId` as immutable once project tasks exist.

### Invites

- Build invite forms around `projectRoleId`, not enum role labels.
- Use `GET /projects/:projectId/invites` for project invite tables.
- Use `acceptInvite` response membership role for post-accept redirect and state bootstrap.

### Kanban Board

- Replace old task assignee fields with `assignedMembers`.
- Replace old reportee assumptions with `reportee`.
- Use `workflowColumnId`, `parentTaskId`, and `rank` from task reads.
- Use `/columns` endpoints for all column CRUD.
- Respect `locked` when rendering delete controls on seeded columns.

### Kanban Task Sheet

- Use `PATCH /projects/:projectId/tasks/:taskId` for full task edits.
- Use checklist/comment/dependency subresource endpoints for focused changes.
- Do not use whole-task patch for single checklist toggles.
- Show comment author from `comment.author`, not from a separate local user lookup when possible.

### Subtask Views

- Treat subtasks exactly like tasks with `parentTaskId !== null`.
- Use the same detail modules:
  - checklist
  - comments
  - dependencies
  - assignedMembers
  - reportee

### Gantt

- Source rows from `GET /projects/:projectId/tasks`.
- Use:
  - `startDate`
  - `endDate`
  - `progress`
  - `dependencies`
  - `assignedMembers`
  - `reportee`
  - `viewMeta.gantt`
- Use `PATCH /projects/:projectId/tasks/:taskId` for single-row edits.
- Use `PATCH /projects/:projectId/tasks/bulk` for batch timeline edits.

### Filters / Search

- Replace any frontend-only task filtering assumptions with backend query params.
- Use:
  - `assignedUserId`
  - `reporteeUserId`
  - `projectRoleId`
  - `startDateFrom`
  - `startDateTo`
  - `endDateFrom`
  - `endDateTo`
  - `hasIncompleteChecklist`
- Do not use stale filter names like `assignedTo`.

### Shared Task Types

- Remove:
  - `assigneeId`
  - `assigneeUserIds`
  - `reporteeId`
- Add:
  - `assignedMembers`
  - `reportee`
  - `TaskDependency.dependsOnTask`

### Permissions

- Workspace UI gates:
  - templates
  - project creation/list
- Project UI gates:
  - task actions
  - invite actions
  - project update/delete
- Resolve project capability from the current user’s entry in `project.members[]`.
