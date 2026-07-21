// ── Success ───────────────────────────────────────────────────────────────────
export const WORKSPACE_INVITE_CREATED = 'Workspace invite sent successfully';
export const WORKSPACE_INVITE_RESENT = 'Workspace invite resent successfully';
export const WORKSPACE_INVITE_CANCELED = 'Workspace invite canceled';
export const WORKSPACE_INVITE_ACCEPTED = 'Workspace invite accepted';
export const WORKSPACE_INVITE_DECLINED = 'Workspace invite declined';
export const WORKSPACE_INVITES_FETCHED = 'Workspace invites fetched successfully';
export const RECEIVED_WORKSPACE_INVITES_FETCHED =
  'Received workspace invites fetched successfully';

// ── Error ─────────────────────────────────────────────────────────────────────
export const WORKSPACE_INVITE_NOT_FOUND = 'Workspace invite not found';
export const WORKSPACE_INVITE_NOT_PENDING =
  'Only pending workspace invites can be resent or canceled';
export const WORKSPACE_INVITE_DUPLICATE =
  'A pending workspace invite already exists for this user in this workspace';
export const WORKSPACE_INVITE_ALREADY_MEMBER =
  'This person is already an active workspace member';
export const WORKSPACE_INVITE_TOKEN_INVALID =
  'Workspace invite token is invalid or has expired';
export const WORKSPACE_INVITE_WORKSPACE_NOT_FOUND = 'Workspace not found';
export const WORKSPACE_INVITE_ROLE_INVALID =
  'The selected workspace role does not belong to this workspace';
export const WORKSPACE_INVITE_ROLE_UNAVAILABLE =
  'The invited workspace role is no longer available for acceptance';
export const WORKSPACE_INVITE_INVITEE_ACCOUNT_NOT_FOUND =
  'Invitee account not found. Please complete registration first.';
export const WORKSPACE_INVITE_FORBIDDEN =
  'You do not have permission to manage invites for this workspace';
