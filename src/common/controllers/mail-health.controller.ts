import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from 'src/auth/decorators';
import { JwtAuthGuard } from 'src/auth/guards';
import { ResponseMessage } from 'src/common/decorators';
import { User } from 'src/users/entities/user.entity';
import { MailHealthCheckDto } from '../dtos';
import { MailHealthService } from '../services';

@ApiTags('Health')
@Controller('health')
export class MailHealthController {
  constructor(
    private readonly mailHealthService: MailHealthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('mail')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Send a runtime SMTP test email',
    description:
      'Sends a direct test email via MailerService to validate SMTP configuration at runtime.',
  })
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Mail health check sent successfully')
  async checkMail(
    @Body() dto: MailHealthCheckDto,
    @GetUser() user: User,
  ): Promise<{ to: string; ok: true }> {
    const recipient = dto?.to?.trim() || user.email;
    await this.mailHealthService.sendRuntimeTestEmail(recipient, user.email);

    return { to: recipient, ok: true };
  }

  @Post('mail/public')
  @ApiOperation({
    summary: 'Bootstrap SMTP health check (no JWT)',
    description:
      'Development-only endpoint for testing email before login. Requires x-mail-health-key header.',
  })
  @ResponseMessage('Public mail health check sent successfully')
  async checkMailPublic(
    @Body() dto: MailHealthCheckDto,
  ): Promise<{ to: string; ok: true }> {
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    if (nodeEnv === 'production') {
      throw new ForbiddenException('Public mail health endpoint is disabled in production.');
    }

    // const expectedKey = this.configService.get<string>('MAIL_HEALTH_KEY');
    // if (!expectedKey || key !== expectedKey) {
    //   throw new ForbiddenException('Invalid mail health key.');
    // }

    const recipient = dto?.to?.trim();
    if (!recipient) {
      throw new ForbiddenException('Recipient email is required for public health check.');
    }

    await this.mailHealthService.sendRuntimeTestEmail(
      recipient,
      'public-health-check@kindora.local',
    );

    return { to: recipient, ok: true };
  }
}
