export const UNAUTHORIZED = 'Unauthorized';
export const WEAK_PASSWORD =
  'Weak Password - Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 digit, and 1 special character';
export const INVALID_TOKEN = 'Invalid token';
export const DEACTIVATED_USER =
  'User account is not activated. Please contact the system admin';
export const INVALID_OTP = 'Invalid One-Time-Password';
export const OTP_EXPIRED = 'One-Time-Password has expired';
export const AUTHENTICATION_REQUIRED = 'Authentication required'
export const SCHOOL_CONTEXT_REQUIRED = 'X-School-Id header is required.'
export const SCHOOL_MEMBER_NOT_FOUND = 'No active school membership found.'
export const BRANCH_DOES_NOT_BELONG_TO_SCHOOL = 'Requested branch does not belong to selected school.'
export const BRANCH_CONTEXT_REQUIRED = 'Branch context required. Provide X-Branch-Id or set default branch.'
export const MEMBERSHIP_NOT_ACTIVE = 'Your membership in this school is not active.'
export const INSUFFICIENT_PERMISSIONS = 'You do not have permission to perform this action.'
export const INVITE_TOKEN_INVALID = 'Invalid invite token. Please contact your admin.'
export const INVITE_TOKEN_EXPIRED = 'This invite link has expired. Please ask your admin to resend the invitation.'
export const TOKEN_REVOKED = 'This session has been revoked. Please sign in again.'
export const INVALID_REFRESH_TOKEN = 'Invalid or expired refresh token. Please sign in again.'
export const ACCOUNT_TEMPORARILY_LOCKED = 'Account temporarily locked after too many failed sign-in attempts. Please try again in 15 minutes.'
export const REAUTH_REQUIRED = 'Please re-authenticate before performing this action.'
export const REAUTH_TOKEN_INVALID = 'Re-authentication token is invalid or has expired.'
export const PASSWORD_RESET_TOKEN_INVALID = 'Password reset link is invalid. Please request a new one.'
export const PASSWORD_RESET_TOKEN_USED = 'This password reset link has already been used. Please request a new one.'
export const PASSWORD_RESET_TOKEN_EXPIRED = 'Password reset link has expired. Please request a new one.'
/** B2 — session management error. */
export const SESSION_NOT_FOUND = 'Session not found or already revoked.'
