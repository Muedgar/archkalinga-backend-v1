import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User, UserType } from 'src/users/entities';
import { UserProfile } from 'src/users/entities/user-profile.entity';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  DEACTIVATED_USER,
  INVALID_OTP,
  INVALID_TOKEN,
  OTP_EXPIRED,
  INVALID_REFRESH_TOKEN,
  ACCOUNT_TEMPORARILY_LOCKED,
  PASSWORD_RESET_TOKEN_INVALID,
  PASSWORD_RESET_TOKEN_USED,
  PASSWORD_RESET_TOKEN_EXPIRED,
  SESSION_NOT_FOUND,
} from './messages';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt, createHash } from 'crypto';
import {
  SignupDto,
  ChangePasswordDto,
  LoginDto,
  OtpDTO,
  RequestResetPasswordDto,
  ResetPasswordDto,
  LogoutDto,
  ReauthDto,
} from './dto';
import { UserSerializer } from 'src/users/serializers';
import {
  INVALID_CREDENTIALS,
  INVALID_CURRENT_PASSWORD,
  USER_NOT_FOUND,
} from 'src/users/messages';
import { JwtPayload } from './interfaces';
import { RequestUser } from './types';
import { Mail } from 'src/common/interfaces';
import { EmailService, AuditLogService } from 'src/common/services';
import {
  OTP_VERIFICATION_EMAIL_JOB,
  PASSWORD_RESET_EMAIL_JOB,
  RESET_PASSWORD_EMAIL_JOB,
  ACCOUNT_LOCKED_EMAIL_JOB,
} from 'src/common/constants';
import { UserSession } from './entities/user-session.entity';
import { Organization } from 'src/organizations/entities/organization.entity';
import { Role } from 'src/roles/roles.entity';
import { FULL_ACCESS_MATRIX } from 'src/roles/types/permission-matrix.type';
import { plainToInstance } from 'class-transformer';

// ── Module-level constants ────────────────────────────────────────────────────

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const INACTIVITY_DAYS = 7;

/** Constant-time dummy — prevents email-enumeration via response timing. */
const DUMMY_HASH = bcrypt.hashSync('__archkalinga_timing_dummy__', 12);

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private sha256Hex(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private signAccessToken(user: User, sessionId?: string): string {
    const payload: JwtPayload = {
      id: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
      sessionId,
    };
    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }

  private generateOTP(): string {
    return randomInt(100000, 1000000).toString();
  }

  private hashOTP(otp: string): string {
    return bcrypt.hashSync(otp, bcrypt.genSaltSync(12));
  }

  private convertOtpToArray(otp: string): number[] {
    return otp.split('').map(Number);
  }

  private async createSession(
    user: User,
    ipAddress: string | null,
    deviceLabel: string | null,
    lastUsedAt: Date | null = null,
  ): Promise<string> {
    const rawToken = randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const session = this.sessionRepo.create({
      user,
      refreshTokenHash: this.sha256Hex(rawToken),
      ipAddress,
      deviceLabel,
      expiresAt,
      lastUsedAt,
      revokedAt: null,
    });

    await this.sessionRepo.save(session);
    return rawToken;
  }

  async issueTokenPair(
    user: User,
    ipAddress: string | null,
    deviceLabel: string | null,
    lastUsedAt: Date | null = null,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const rawRefresh = await this.createSession(
      user,
      ipAddress,
      deviceLabel,
      lastUsedAt,
    );
    const session = await this.sessionRepo.findOne({
      where: { refreshTokenHash: this.sha256Hex(rawRefresh) },
    });

    const accessToken = this.signAccessToken(user, session?.id);
    return { accessToken, refreshToken: rawRefresh };
  }

  private async revokeAllSessions(userPkid: number): Promise<void> {
    await this.sessionRepo
      .createQueryBuilder()
      .update(UserSession)
      .set({ revokedAt: new Date() })
      .where('user_id = :userPkid', { userPkid })
      .andWhere('"revokedAt" IS NULL')
      .execute();
  }

  /** Load a user with all relations needed for API responses. */
  private async loadFullUser(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['organization', 'role'],
    });
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);
    return user;
  }

  // ---------------------------------------------------------------------------
  // Signup
  // ---------------------------------------------------------------------------

  async signup(
    dto: SignupDto,
    ipAddress: string | null,
    deviceLabel: string | null,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: UserSerializer;
  }> {
    // Check email uniqueness
    const existing = await this.userRepo.findOne({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const hashedPassword = bcrypt.hashSync(
      dto.password,
      bcrypt.genSaltSync(12),
    );

    const user = await this.userRepo.manager.transaction(async (tx) => {
      // 1. Create Organization
      //    INDIVIDUAL → personal workspace derived from user's name
      //    ORGANIZATION → use supplied org fields
      const orgName =
        dto.userType === UserType.ORGANIZATION && dto.organizationName
          ? dto.organizationName.trim()
          : `${dto.firstName.trim()} ${dto.lastName.trim()}'s Workspace`;

      const org = tx.create(Organization, {
        name: orgName,
        address: dto.organizationAddress ?? null,
        city: dto.organizationCity ?? null,
        country: dto.organizationCountry ?? null,
        website: dto.organizationWebsite ?? null,
      });
      const savedOrg = await tx.save(org);

      // 2. Create Admin role for this organization
      const roleName = 'Admin';
      const role = tx.create(Role, {
        name: roleName,
        slug: 'admin',
        status: true,
        permissions: FULL_ACCESS_MATRIX,
        organizationId: savedOrg.id,
        organization: savedOrg,
      });
      const savedRole = await tx.save(role);

      // 3. Create User
      const newUser = tx.create(User, {
        firstName: dto.firstName,
        lastName: dto.lastName,
        userName: dto.userName,
        email: dto.email,
        password: hashedPassword,
        title: dto.title ?? null,
        userType: dto.userType,
        status: true,
        isDefaultPassword: false,
        twoFactorAuthentication: false,
        emailVerified: false,
        organizationId: savedOrg.id,
        organization: savedOrg,
        roleId: savedRole.id,
        role: savedRole,
        createdById: null,
      });
      const savedUser = await tx.save(newUser);

      // 4. Create UserProfile
      const profile = tx.create(UserProfile, {
        userId: savedUser.id,
        user: savedUser,
        profession: dto.profession ?? null,
        specialty: dto.specialty ?? null,
        bio: null,
        organizationName:
          dto.userType === UserType.ORGANIZATION ? orgName : null,
        organizationWebsite: dto.organizationWebsite ?? null,
        teamSize: null,
      });
      await tx.save(profile);

      return savedUser;
    });

    const fullUser = await this.loadFullUser(user.id);
    const { accessToken, refreshToken } = await this.issueTokenPair(
      fullUser,
      ipAddress,
      deviceLabel,
    );

    return {
      accessToken,
      refreshToken,
      user: plainToInstance(UserSerializer, fullUser, {
        excludeExtraneousValues: true,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(
    loginDTO: LoginDto,
    ipAddress: string | null,
    deviceLabel: string | null,
  ): Promise<{
    accessToken?: string;
    refreshToken?: string;
    user?: UserSerializer | { email: string };
    requiresOtp?: boolean;
  }> {
    const { email, password } = loginDTO;
    const user = await this.userRepo.findOne({ where: { email } });

    if (!user) {
      bcrypt.compareSync(password, DUMMY_HASH);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(ACCOUNT_TEMPORARILY_LOCKED);
    }

    const passwordValid = bcrypt.compareSync(password, user.password);

    if (!passwordValid) {
      user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
      const willLock = user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS;

      if (willLock) {
        user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
        user.tokenVersion = (user.tokenVersion ?? 0) + 1;
        await this.revokeAllSessions(user.pkid);
      }

      await this.userRepo.save(user);

      void this.auditLogService.log({
        actorId: user.id,
        action: 'login:failed',
        resource: 'user',
        resourceId: user.id,
        ipAddress,
        payload: { failedAttempts: user.failedLoginAttempts },
      });

      if (willLock) {
        void this.auditLogService.log({
          actorId: user.id,
          action: 'account:locked',
          resource: 'user',
          resourceId: user.id,
          ipAddress,
          payload: { lockedUntil: user.lockedUntil },
        });

        const lockEmail: Mail = {
          to: user.email,
          data: { firstName: user.firstName },
        };
        void this.emailService.sendEmail(lockEmail, ACCOUNT_LOCKED_EMAIL_JOB);
      }

      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!user.status) throw new UnauthorizedException(DEACTIVATED_USER);

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await this.userRepo.save(user);

    if (user.twoFactorAuthentication) {
      const otp = this.generateOTP();
      const otpExpiry = new Date();
      otpExpiry.setMinutes(otpExpiry.getMinutes() + 5);

      user.emailVerificationKey = this.hashOTP(otp);
      user.emailVerificationExpiry = otpExpiry;
      await this.userRepo.save(user);

      const emailData: Mail = {
        to: user.email,
        data: {
          firstName: user.userName,
          otp: this.convertOtpToArray(otp),
        },
      };
      await this.emailService.sendEmail(emailData, OTP_VERIFICATION_EMAIL_JOB);
      return { requiresOtp: true, user: { email: user.email } };
    }

    const fullUser = await this.loadFullUser(user.id);
    const { accessToken, refreshToken } = await this.issueTokenPair(
      fullUser,
      ipAddress,
      deviceLabel,
    );

    return {
      accessToken,
      refreshToken,
      user: plainToInstance(UserSerializer, fullUser, {
        excludeExtraneousValues: true,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // OTP (2FA)
  // ---------------------------------------------------------------------------

  async validateOTP(
    otpDto: OtpDTO,
    ipAddress: string | null,
    deviceLabel: string | null,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: UserSerializer;
  }> {
    const { email, otp } = otpDto;
    const user = await this.userRepo.findOne({ where: { email } });

    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);

    if (!bcrypt.compareSync(otp, user.emailVerificationKey)) {
      throw new UnauthorizedException(INVALID_OTP);
    }

    if (new Date() > user.emailVerificationExpiry) {
      throw new UnauthorizedException(OTP_EXPIRED);
    }

    user.emailVerificationKey = '';
    user.emailVerificationExpiry = new Date();
    user.emailVerified = true;
    await this.userRepo.save(user);

    const fullUser = await this.loadFullUser(user.id);
    const { accessToken, refreshToken } = await this.issueTokenPair(
      fullUser,
      ipAddress,
      deviceLabel,
    );

    return {
      accessToken,
      refreshToken,
      user: plainToInstance(UserSerializer, fullUser, {
        excludeExtraneousValues: true,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Current user (GET /auth/me)
  // ---------------------------------------------------------------------------

  async getMe(userId: string): Promise<UserSerializer> {
    const user = await this.loadFullUser(userId);
    return plainToInstance(UserSerializer, user, {
      excludeExtraneousValues: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------------

  async requestPasswordReset(dto: RequestResetPasswordDto): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });

    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    user.passwordResetTokenHash = this.sha256Hex(rawToken);
    user.passwordResetTokenExpiresAt = expiresAt;
    user.passwordResetTokenUsedAt = null;
    await this.userRepo.save(user);

    const emailData: Mail = {
      to: user.email,
      data: { firstName: user.firstName, token: rawToken },
    };
    await this.emailService.sendEmailStrict(
      emailData,
      RESET_PASSWORD_EMAIL_JOB,
    );
  }

  async resetPassword(rawToken: string, dto: ResetPasswordDto): Promise<void> {
    const hash = this.sha256Hex(rawToken);
    const user = await this.userRepo.findOne({
      where: { passwordResetTokenHash: hash },
    });

    if (!user) throw new BadRequestException(PASSWORD_RESET_TOKEN_INVALID);
    if (user.passwordResetTokenUsedAt)
      throw new BadRequestException(PASSWORD_RESET_TOKEN_USED);
    if (
      !user.passwordResetTokenExpiresAt ||
      user.passwordResetTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException(PASSWORD_RESET_TOKEN_EXPIRED);
    }

    user.password = bcrypt.hashSync(dto.password, bcrypt.genSaltSync(12));
    user.isDefaultPassword = false;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.passwordResetTokenUsedAt = new Date();
    await this.userRepo.save(user);
    await this.revokeAllSessions(user.pkid);

    const emailData: Mail = {
      to: user.email,
      data: { firstName: user.firstName },
    };
    await this.emailService.sendEmail(emailData, PASSWORD_RESET_EMAIL_JOB);
  }

  // ---------------------------------------------------------------------------
  // Change password (self-service, requires current password)
  // ---------------------------------------------------------------------------

  async changePassword(
    dto: ChangePasswordDto,
    reqUser: RequestUser,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: reqUser.id } });
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);

    if (!bcrypt.compareSync(dto.currentPassword, user.password)) {
      throw new BadRequestException(INVALID_CURRENT_PASSWORD);
    }

    user.password = bcrypt.hashSync(dto.newPassword, bcrypt.genSaltSync(12));
    user.isDefaultPassword = false;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepo.save(user);
    await this.revokeAllSessions(user.pkid);
  }

  // ---------------------------------------------------------------------------
  // Token refresh
  // ---------------------------------------------------------------------------

  async refreshToken(
    rawToken: string,
    ipAddress: string | null,
    deviceLabel: string | null,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = this.sha256Hex(rawToken);
    const session = await this.sessionRepo.findOne({
      where: { refreshTokenHash: hash },
      relations: ['user'],
    });

    if (!session) throw new UnauthorizedException(INVALID_REFRESH_TOKEN);

    if (session.revokedAt) {
      await this.revokeAllSessions(session.user.pkid);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    const inactivityCutoff = new Date(
      Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000,
    );
    const lastActivity = session.lastUsedAt ?? session.createdAt;
    if (lastActivity < inactivityCutoff) {
      session.revokedAt = new Date();
      await this.sessionRepo.save(session);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    session.revokedAt = new Date();
    await this.sessionRepo.save(session);

    const user = await this.userRepo.findOne({
      where: { pkid: session.user.pkid },
    });
    if (!user || !user.status)
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);

    return this.issueTokenPair(user, ipAddress, deviceLabel, new Date());
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async getSessions(userId: string) {
    const sessions = await this.sessionRepo
      .createQueryBuilder('s')
      .innerJoin('s.user', 'u')
      .where('u.id = :userId', { userId })
      .andWhere('s."revokedAt" IS NULL')
      .andWhere('s."expiresAt" > NOW()')
      .orderBy('s."createdAt"', 'DESC')
      .getMany();

    return sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      ipAddress: s.ipAddress,
      lastUsedAt: s.lastUsedAt,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessionRepo
      .createQueryBuilder('s')
      .innerJoin('s.user', 'u')
      .where('u.id = :userId', { userId })
      .andWhere('s.id = :sessionId', { sessionId })
      .andWhere('s."revokedAt" IS NULL')
      .getOne();

    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);

    session.revokedAt = new Date();
    await this.sessionRepo.save(session);
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  async logout(dto: LogoutDto): Promise<void> {
    const hash = this.sha256Hex(dto.refreshToken);
    const session = await this.sessionRepo.findOne({
      where: { refreshTokenHash: hash },
    });

    if (session && !session.revokedAt) {
      session.revokedAt = new Date();
      await this.sessionRepo.save(session);
    }
  }

  async logoutAll(reqUser: RequestUser): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: reqUser.id } });
    if (user) {
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await this.userRepo.save(user);
      await this.revokeAllSessions(user.pkid);
    }
  }

  // ---------------------------------------------------------------------------
  // Re-auth gate
  // ---------------------------------------------------------------------------

  async reauth(
    reqUser: RequestUser,
    dto: ReauthDto,
  ): Promise<{ reauthToken: string }> {
    const user = await this.userRepo.findOne({ where: { id: reqUser.id } });

    if (!user || !bcrypt.compareSync(dto.currentPassword, user.password)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const payload: JwtPayload = {
      id: user.id,
      email: user.email,
      purpose: 'reauth',
    };

    const reauthToken = this.jwtService.sign(payload, {
      expiresIn: '5m',
      secret: this.configService.get('SECRET_KEY'),
    });

    return { reauthToken };
  }

  // ---------------------------------------------------------------------------
  // Token decode utility (invite flows, etc.)
  // ---------------------------------------------------------------------------

  async decodeToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new BadRequestException(INVALID_TOKEN);
    }
  }
}
