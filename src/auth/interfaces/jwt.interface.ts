/**
 * JWT token payload.
 * Carries only the user's stable identity — no role or school data.
 * School context is resolved per-request via X-School-Id header (Phase 3).
 *
 * The optional `purpose` claim narrows a token to a specific use-case:
 *   - 'invite'  → first-time password setup via POST /auth/accept-invite
 *   - undefined → standard session / password-reset token
 */
export interface JwtPayload {
  id: string;
  email: string;
  /**
   * Mirrors User.tokenVersion at signing time.
   * JwtStrategy rejects the token if the stored value has since been incremented.
   */
  tokenVersion?: number;
  /** ID of the UserSession row this access-token belongs to. */
  sessionId?: string;
  /** Restricts the token to a specific flow (e.g. 'invite', 'reauth'). */
  purpose?: string;
}
