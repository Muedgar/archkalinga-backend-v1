import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const baseUser = {
    id: 'user-public-id',
    pkid: 7,
    email: 'ndoli@example.com',
    firstName: 'Ndoli',
    lastName: 'User',
    userName: 'ndoli',
    status: true,
    tokenVersion: 3,
    isPublicProfile: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const makeStrategy = ({
    user = baseUser,
    session,
  }: {
    user?: typeof baseUser | null;
    session?: Record<string, unknown> | null;
  }) => {
    const userRepo = {
      findOne: jest.fn().mockResolvedValue(user),
    };
    const sessionRepo = {
      findOne: jest.fn().mockResolvedValue(session),
    };
    const configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;

    const strategy = new JwtStrategy(
      configService,
      userRepo as any,
      sessionRepo as any,
    );

    return { strategy, userRepo, sessionRepo };
  };

  it('rejects a token when its session was revoked', async () => {
    const { strategy } = makeStrategy({
      session: {
        id: 'session-id',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: { pkid: baseUser.pkid },
      },
    });

    await expect(
      strategy.validate({
        id: baseUser.id,
        email: baseUser.email,
        tokenVersion: baseUser.tokenVersion,
        sessionId: 'session-id',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token when its session belongs to another user', async () => {
    const { strategy } = makeStrategy({
      session: {
        id: 'session-id',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { pkid: 999 },
      },
    });

    await expect(
      strategy.validate({
        id: baseUser.id,
        email: baseUser.email,
        tokenVersion: baseUser.tokenVersion,
        sessionId: 'session-id',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a token with an active session owned by the user', async () => {
    const { strategy } = makeStrategy({
      session: {
        id: 'session-id',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { pkid: baseUser.pkid },
      },
    });

    await expect(
      strategy.validate({
        id: baseUser.id,
        email: baseUser.email,
        tokenVersion: baseUser.tokenVersion,
        sessionId: 'session-id',
      }),
    ).resolves.toMatchObject({
      id: baseUser.id,
      email: baseUser.email,
    });
  });
});
