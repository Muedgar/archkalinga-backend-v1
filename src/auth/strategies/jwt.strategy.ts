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
   * Loads the user with organization + role (including permissions matrix)
   * so downstream guards can enforce RBAC without an extra DB query.
   */
  async validate(payload: JwtPayload): Promise<Omit<User, 'password'>> {
    const user = await this.userRepo.findOne({
      where: { id: payload.id },
      relations: ['organization', 'role'],
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

    // Strip password before attaching to request
    const { password: _pw, ...safeUser } = user;
    return safeUser as Omit<User, 'password'>;
  }
}
