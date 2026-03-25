import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as requiring the caller to have recently re-authenticated.
 * Enforcement is performed by ReauthGuard, which validates the X-Reauth-Token
 * header (a short-lived JWT with purpose: 'reauth' issued by POST /auth/reauth).
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, ReauthGuard)
 *   @RequireReauth()
 *   changePassword(...) { ... }
 */
export const REQUIRE_REAUTH_KEY = 'require_reauth';
export const RequireReauth = () => SetMetadata(REQUIRE_REAUTH_KEY, true);
