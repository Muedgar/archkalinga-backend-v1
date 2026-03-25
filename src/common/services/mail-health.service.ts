import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailHealthService {
  private readonly logger = new Logger(MailHealthService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendRuntimeTestEmail(to: string, requestedByEmail: string): Promise<void> {
    if (!to) {
      throw new BadRequestException('Recipient email is required.');
    }

    const sendMailEnv = this.configService.get<string>('SEND_MAIL');
    const enabled = ['true', '1', 'yes', 'on'].includes(
      String(sendMailEnv).toLowerCase(),
    );

    if (!enabled) {
      throw new BadRequestException(
        `Mail dispatch is disabled (SEND_MAIL=${sendMailEnv ?? 'undefined'}).`,
      );
    }

    try {
      await this.mailerService.sendMail({
        to,
        subject: '[ArchKalinga] SMTP Health Check',
        text: `SMTP health check passed.\nRequested by: ${requestedByEmail}\nTime: ${new Date().toISOString()}`,
        html: `
          <p>SMTP health check passed.</p>
          <p><strong>Requested by:</strong> ${requestedByEmail}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        `,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMTP health check failed: ${message}`);
      throw new ServiceUnavailableException(
        `SMTP health check failed: ${message}`,
      );
    }
  }
}
