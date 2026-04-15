import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User } from 'src/users/entities';
import { Repository } from 'typeorm';
import { JwtPayload } from '../interfaces';
import { TOKEN_REVOKED, UNAUTHORIZED } from '../messages';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
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
    const user = await this.userRepo.findOne({ where: { id: payload.id } });

    if (!user || !user.status) {
      throw new UnauthorizedException(UNAUTHORIZED);
    }

    if (
      payload.tokenVersion !== undefined &&
      user.tokenVersion !== payload.tokenVersion
    ) {
      throw new UnauthorizedException(TOKEN_REVOKED);
    }

    const { password: _pw, ...safeUser } = user;
    return safeUser as Omit<User, 'password'>;
  }
}
