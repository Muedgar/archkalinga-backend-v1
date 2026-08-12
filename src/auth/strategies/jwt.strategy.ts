import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User } from 'src/users/entities';
import { Repository } from 'typeorm';
import { JwtPayload } from '../interfaces';
import { UserSession } from '../entities/user-session.entity';
import { INVALID_REFRESH_TOKEN, TOKEN_REVOKED, UNAUTHORIZED } from '../messages';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get<string>('SECRET_KEY') ?? '',
    });
  }

  /**
   * Validates the JWT payload and attaches the bare User to req.user.
   * Workspace-role relations are loaded per-request by WorkspaceGuard.
   */
  async validate(payload: JwtPayload): Promise<Omit<User, 'password'>> {
    // Select only the columns needed for token validation — loading the full
    // User record on every request added 50-200ms per API call.
    const user = await this.userRepo.findOne({
      where: { id: payload.id },
      select: ['id', 'pkid', 'email', 'firstName', 'lastName', 'userName',
               'status', 'tokenVersion', 'isPublicProfile', 'createdAt', 'updatedAt'],
    });

    if (!user || !user.status) {
      throw new UnauthorizedException(UNAUTHORIZED);
    }

    if (
      payload.tokenVersion !== undefined &&
      user.tokenVersion !== payload.tokenVersion
    ) {
      throw new UnauthorizedException(TOKEN_REVOKED);
    }

    if (payload.sessionId) {
      const session = await this.sessionRepo.findOne({
        where: { id: payload.sessionId },
        relations: ['user'],
      });

      if (
        !session ||
        session.revokedAt ||
        session.expiresAt < new Date() ||
        session.user?.pkid !== user.pkid
      ) {
        throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
      }
    }

    const { password: _pw, ...safeUser } = user;
    return safeUser as Omit<User, 'password'>;
  }
}
