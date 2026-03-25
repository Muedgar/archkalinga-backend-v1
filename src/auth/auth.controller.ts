import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ResponseMessage, LogActivity } from 'src/common/decorators';
import {
  AUTHENTICATED,
  FORGOT_PASSWORD_EMAIL_SENT,
  PASSWORD_CHANGED,
  PASSWORD_RESET,
  TOKEN_REFRESHED,
  LOGGED_OUT,
  LOGGED_OUT_ALL,
  REAUTH_SUCCESS,
  SESSIONS_FETCHED,
  SESSION_REVOKED,
  USER_REGISTERED,
} from './messages';
import {
  SignupDto,
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  OtpDTO,
  ReauthDto,
  RefreshTokenDto,
  RequestResetPasswordDto,
  ResetPasswordDto,
} from './dto';
import { JwtAuthGuard, ReauthGuard } from './guards';
import { GetUser } from './decorators';
import { User } from 'src/users/entities';

function getIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

function getDeviceLabel(req: Request): string | null {
  const ua = req.headers['user-agent'];
  return ua ? ua.slice(0, 250) : null;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Public endpoints ────────────────────────────────────────────────────────

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new account (INDIVIDUAL or ORGANIZATION)' })
  @ApiResponse({ status: 201, description: 'Account created — returns token pair and user object' })
  @ApiResponse({ status: 400, description: 'Validation error or email already in use' })
  @ResponseMessage(USER_REGISTERED)
  @LogActivity({ action: 'signup', resource: 'user', includeBody: true })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.authService.signup(dto, getIp(req), getDeviceLabel(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful — returns token pair and user object' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or account locked' })
  @ResponseMessage(AUTHENTICATED)
  @LogActivity({ action: 'login', resource: 'user' })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  login(@Body() loginDTO: LoginDto, @Req() req: Request) {
    return this.authService.login(loginDTO, getIp(req), getDeviceLabel(req));
  }

  @Post('validate-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate 2FA OTP after login' })
  @ApiResponse({ status: 200, description: 'OTP valid — returns token pair' })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP' })
  @ResponseMessage(AUTHENTICATED)
  @LogActivity({ action: 'validate:otp', resource: 'user' })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  validateOtp(@Body() otpDTO: OtpDTO, @Req() req: Request) {
    return this.authService.validateOTP(otpDTO, getIp(req), getDeviceLabel(req));
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password-reset email' })
  @ApiResponse({ status: 200, description: 'Reset email dispatched (identical response whether email exists or not)' })
  @ResponseMessage(FORGOT_PASSWORD_EMAIL_SENT)
  @LogActivity({ action: 'request:password-reset', resource: 'user', includeBody: true })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  requestPasswordReset(@Body() dto: RequestResetPasswordDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post(':token/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using a one-time token from email' })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  @ApiResponse({ status: 400, description: 'Token invalid, expired, or already used' })
  @ResponseMessage(PASSWORD_RESET)
  @LogActivity({ action: 'reset:password', resource: 'user' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  resetPassword(@Param('token') token: string, @Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(token, dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and receive a new access token' })
  @ApiResponse({ status: 200, description: 'New token pair issued' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid, expired, or revoked' })
  @ResponseMessage(TOKEN_REFRESHED)
  @LogActivity({ action: 'refresh:token', resource: 'session' })
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refreshToken(dto.refreshToken, getIp(req), getDeviceLabel(req));
  }

  // ── Protected endpoints ─────────────────────────────────────────────────────

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user with org and role' })
  @ApiResponse({ status: 200, description: 'User object including organization and role permissions' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ResponseMessage('User fetched')
  @UseGuards(JwtAuthGuard)
  getMe(@GetUser() user: User) {
    return this.authService.getMe(user.id);
  }

  @Patch('change-password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password (requires re-auth token)' })
  @ApiResponse({ status: 200, description: 'Password changed — all other sessions revoked' })
  @ApiResponse({ status: 401, description: 'Invalid access token or re-auth token' })
  @ResponseMessage(PASSWORD_CHANGED)
  @LogActivity({ action: 'change:password', resource: 'user' })
  @UseGuards(JwtAuthGuard, ReauthGuard)
  changePassword(@Body() dto: ChangePasswordDto, @GetUser() user: User) {
    return this.authService.changePassword(dto, user);
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out of the current device' })
  @ApiResponse({ status: 200, description: 'Session terminated' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ResponseMessage(LOGGED_OUT)
  @LogActivity({ action: 'logout', resource: 'session' })
  @UseGuards(JwtAuthGuard)
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto);
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out of all devices and revoke all sessions' })
  @ApiResponse({ status: 200, description: 'All sessions terminated' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ResponseMessage(LOGGED_OUT_ALL)
  @LogActivity({ action: 'logout:all', resource: 'session' })
  @UseGuards(JwtAuthGuard)
  logoutAll(@GetUser() user: User) {
    return this.authService.logoutAll(user);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all active sessions for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Array of active session records' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ResponseMessage(SESSIONS_FETCHED)
  @UseGuards(JwtAuthGuard)
  getSessions(@GetUser() user: User) {
    return this.authService.getSessions(user.id);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a specific session by ID' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ResponseMessage(SESSION_REVOKED)
  @LogActivity({ action: 'revoke:session', resource: 'session' })
  @UseGuards(JwtAuthGuard)
  revokeSession(@GetUser() user: User, @Param('id') sessionId: string) {
    return this.authService.revokeSession(user.id, sessionId);
  }

  @Post('reauth')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify current password before a sensitive action — returns a short-lived re-auth token' })
  @ApiResponse({ status: 200, description: 'Identity confirmed — re-auth token returned' })
  @ApiResponse({ status: 401, description: 'Wrong password or invalid access token' })
  @ResponseMessage(REAUTH_SUCCESS)
  @LogActivity({ action: 'reauth', resource: 'user' })
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  reauth(@GetUser() user: User, @Body() dto: ReauthDto) {
    return this.authService.reauth(user, dto);
  }
}

export { ReauthGuard };
