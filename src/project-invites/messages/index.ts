// ── Success ───────────────────────────────────────────────────────────────────
export const INVITE_CREATED = 'Invite sent successfully';
export const INVITE_RESENT = 'Invite resent successfully';
export const INVITE_CANCELED = 'Invite canceled';
export const INVITE_ACCEPTED = 'Invite accepted';
export const INVITES_FETCHED = 'Invites fetched successfully';

// ── Error ─────────────────────────────────────────────────────────────────────
export const INVITE_NOT_FOUND = 'Invite not found';
export const INVITE_NOT_PENDING =
  'Only pending invites can be resent or canceled';
export const INVITE_DUPLICATE =
  'A pending invite already exists for this email and target';
export const INVITE_ALREADY_MEMBER =
  'This person is already an active project member';
export const INVITE_TOKEN_INVALID = 'Invite token is invalid or has expired';
export const INVITE_PROJECT_NOT_FOUND =
  'Project not found in your organization';
export const INVITE_PROJECT_ROLE_INVALID =
  'The selected project role does not belong to this project';
export const INVITE_PROJECT_ROLE_UNAVAILABLE =
  'The invited project role is no longer available for acceptance';
export const INVITEE_ACCOUNT_NOT_FOUND =
  'Invitee account not found. Please complete registration first.';
export const INVITE_TASK_NOT_FOUND =
  'The referenced task was not found in this project';
export const INVITE_SUBTASK_INVALID =
  'The referenced subtask does not belong to the given task';
export const INVITE_FORBIDDEN =
  'You do not have permission to manage invites for this project';
