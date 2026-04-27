export const PROJECT_CREATED = 'Project created successfully';
export const PROJECT_DELETED = 'Project deleted successfully';
export const PROJECT_UPDATED = 'Project updated successfully';
export const PROJECT_FETCHED = 'Project fetched successfully';
export const PROJECTS_FETCHED = 'Projects fetched successfully';

export const PROJECT_NOT_FOUND = 'Project not found';
export const PROJECT_ACCESS_DENIED = 'You do not have access to this project';
export const INVALID_PROJECT_DATE_RANGE =
  'Project start date cannot be after the end date';
export const PROJECT_TEMPLATE_CHANGE_FORBIDDEN =
  'Project template cannot be changed after project tasks have been created';
export const DEFAULT_PROJECT_ROLE_SETUP_FAILED =
  'Required default project roles could not be created for this project';
export const DEFAULT_PROJECT_ROLE_NOT_FOUND =
  'Default contributor project role could not be found for this project';
export const TEMPLATE_NOT_IN_ORG = 'Template not found in your organization';
export const MEMBER_NOT_IN_ORG =
  'One or more members do not belong to your organization';
export const INVALID_PROJECT_MEMBER_ROLE =
  'One or more submitted project roles do not belong to this project or are inactive';
export const PROJECT_MEMBER_NOT_FOUND = 'Project member not found';
export const PROJECT_MEMBERS_FETCHED = 'Project members fetched successfully';
export const PROJECT_MEMBER_ROLE_UPDATED =
  'Project member role updated successfully';
export const PROJECT_MEMBER_ROLE_CHANGE_FORBIDDEN =
  'Protected member roles cannot be reassigned through this endpoint';

export const PROJECT_ROLE_CREATED = 'Project role created successfully';
export const PROJECT_ROLE_UPDATED = 'Project role updated successfully';
export const PROJECT_ROLE_DELETED = 'Project role deleted successfully';
export const PROJECT_ROLE_FETCHED = 'Project role fetched successfully';
export const PROJECT_ROLES_FETCHED = 'Project roles fetched successfully';

export const PROJECT_ROLE_NOT_FOUND = 'Project role not found';
export const PROJECT_ROLE_ALREADY_EXISTS =
  'A project role with this name already exists in the project';
export const PROJECT_ROLE_DELETE_FORBIDDEN =
  'Protected project roles cannot be deleted';
export const INVALID_PROJECT_ROLE_DISABLE =
  'Protected project roles cannot be disabled';
export const PROJECT_ROLE_IN_USE =
  'This project role cannot be changed because active memberships or pending invites still use it';
export const INVALID_PROJECT_ROLE_NAME =
  'Project role name must contain letters or numbers';

// ── Project Config (statuses, priorities, severities, task types, labels) ─────
export const CONFIG_STATUS_CREATED   = 'Status created successfully';
export const CONFIG_STATUS_UPDATED   = 'Status updated successfully';
export const CONFIG_STATUS_DELETED   = 'Status deleted successfully';
export const CONFIG_STATUS_FETCHED   = 'Status fetched successfully';
export const CONFIG_STATUSES_FETCHED = 'Statuses fetched successfully';
export const CONFIG_STATUS_NOT_FOUND = 'Status not found';
export const CONFIG_STATUS_KEY_TAKEN = 'A status with this key already exists in the project';
export const CONFIG_STATUS_HAS_TASKS = 'Cannot delete a status that still has tasks assigned to it';

export const CONFIG_PRIORITY_CREATED   = 'Priority created successfully';
export const CONFIG_PRIORITY_UPDATED   = 'Priority updated successfully';
export const CONFIG_PRIORITY_DELETED   = 'Priority deleted successfully';
export const CONFIG_PRIORITY_FETCHED   = 'Priority fetched successfully';
export const CONFIG_PRIORITIES_FETCHED = 'Priorities fetched successfully';
export const CONFIG_PRIORITY_NOT_FOUND = 'Priority not found';
export const CONFIG_PRIORITY_KEY_TAKEN = 'A priority with this key already exists in the project';
export const CONFIG_PRIORITY_HAS_TASKS = 'Cannot delete a priority that still has tasks assigned to it';

export const CONFIG_SEVERITY_CREATED   = 'Severity created successfully';
export const CONFIG_SEVERITY_UPDATED   = 'Severity updated successfully';
export const CONFIG_SEVERITY_DELETED   = 'Severity deleted successfully';
export const CONFIG_SEVERITY_FETCHED   = 'Severity fetched successfully';
export const CONFIG_SEVERITIES_FETCHED = 'Severities fetched successfully';
export const CONFIG_SEVERITY_NOT_FOUND = 'Severity not found';
export const CONFIG_SEVERITY_KEY_TAKEN = 'A severity with this key already exists in the project';

export const CONFIG_TASK_TYPE_CREATED   = 'Task type created successfully';
export const CONFIG_TASK_TYPE_UPDATED   = 'Task type updated successfully';
export const CONFIG_TASK_TYPE_DELETED   = 'Task type deleted successfully';
export const CONFIG_TASK_TYPE_FETCHED   = 'Task type fetched successfully';
export const CONFIG_TASK_TYPES_FETCHED  = 'Task types fetched successfully';
export const CONFIG_TASK_TYPE_NOT_FOUND = 'Task type not found';
export const CONFIG_TASK_TYPE_KEY_TAKEN = 'A task type with this key already exists in the project';
export const CONFIG_TASK_TYPE_HAS_TASKS = 'Cannot delete a task type that still has tasks assigned to it';

export const CONFIG_LABEL_CREATED   = 'Label created successfully';
export const CONFIG_LABEL_UPDATED   = 'Label updated successfully';
export const CONFIG_LABEL_DELETED   = 'Label deleted successfully';
export const CONFIG_LABEL_FETCHED   = 'Label fetched successfully';
export const CONFIG_LABELS_FETCHED  = 'Labels fetched successfully';
export const CONFIG_LABEL_NOT_FOUND = 'Label not found';
export const CONFIG_LABEL_KEY_TAKEN = 'A label with this key already exists in the project';
