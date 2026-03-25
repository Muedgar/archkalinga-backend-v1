import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../interfaces';
import { REAUTH_REQUIRED, REAUTH_TOKEN_INVALID } from '../messages';

/**
 * ReauthGuard — Phase 10b.
 *
 * Validates the `X-Reauth-Token` header on sensitive routes (password change,
 * 2FA toggle, etc.). The token is a short-lived (5 min) JWT with
 * `purpose: 'reauth'` issued by POST /auth/reauth after the user proves
 * their current password.
 *
 * Must be placed AFTER JwtAuthGuard in the @UseGuards() chain.
 */
@Injectable()
export class ReauthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, any>>();

    const token = request.headers?.['x-reauth-token'] as string | undefined;

    if (!token) {
      throw new UnauthorizedException(REAUTH_REQUIRED);
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('SECRET_KEY'),
      });

      if (payload.purpose !== 'reauth') {
        throw new Error('wrong purpose');
      }

      return true;
    } catch {
      throw new UnauthorizedException(REAUTH_TOKEN_INVALID);
    }
  }
}
