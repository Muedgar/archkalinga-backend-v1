export const TASK_PROJECT_NOT_FOUND = 'Project not found';
export const TASK_PROJECT_ACCESS_DENIED =
  'You do not have access to this project';
export const TASK_NOT_FOUND = 'Task not found';
export const WORKFLOW_COLUMN_NOT_FOUND = 'Workflow column not found';
export const WORKFLOW_COLUMN_HAS_TASKS =
  'Workflow column cannot be deleted while tasks still exist';
export const WORKFLOW_COLUMN_LOCKED =
  'Locked default workflow columns cannot be deleted';
export const INVALID_TASK_DATE_RANGE =
  'startDate must be before or equal to endDate';
export const INVALID_TASK_INCLUDE = 'Invalid task include parameter';
export const INVALID_TASK_PARENT =
  'Parent task must belong to the same project and be active';
export const INVALID_TASK_ASSIGNEES =
  'All assignees must be active members of the project';
export const INVALID_TASK_ASSIGNED_MEMBERS =
  'Assigned members must be active project members and match their current project roles';
export const INVALID_TASK_REPORTEE =
  'Reportee must be an active project member and match the submitted project role';
export const INVALID_TASK_DEPENDENCY =
  'Dependencies must reference other active tasks in the same project without cycles';
export const INVALID_TASK_COLUMN =
  'Workflow column must belong to the same project';
export const INVALID_TASK_MOVE_TARGET =
  'beforeTaskId and afterTaskId must reference tasks in the same destination scope';
export const INVALID_TASK_HIERARCHY =
  'A task cannot be moved under itself or one of its descendants';
export const TASK_COMMENT_NOT_FOUND = 'Task comment not found';
export const TASK_COMMENT_ACCESS_DENIED =
  'You can only edit or delete your own comments';
export const TASK_CHECKLIST_ITEM_NOT_FOUND = 'Task checklist item not found';
export const TASK_DEPENDENCY_NOT_FOUND = 'Task dependency not found';
export const TOO_MANY_TASK_INCLUDES =
  'Too many include values requested for task list';
