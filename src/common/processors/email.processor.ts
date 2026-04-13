/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';

import { MailerService } from '@nestjs-modules/mailer';
import { Logger } from '@nestjs/common';
import {
  ACCOUNT_LOCKED_EMAIL_JOB,
  INVITE_EMAIL_JOB,
  MAIL_QUEUE,
  OTP_VERIFICATION_EMAIL_JOB,
  PASSWORD_RESET_EMAIL_JOB,
  REGISTER_EMAIL_JOB,
  RESET_PASSWORD_EMAIL_JOB,
} from '../constants';
import { Mail } from '../interfaces';

@Processor(MAIL_QUEUE)
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private mailService: MailerService) {}

  private async send(
    job: Job<Mail>,
    subject: string,
    template: string,
  ): Promise<void> {
    const { data } = job;
    try {
      await this.mailService.sendMail({
        ...data,
        subject,
        template,
        context: { data: data.data },
      });
      this.logger.log(`[${template}] sent to ${data.to}`);
    } catch (error) {
      this.logger.error(
        `[${template}] failed for ${data.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error; // re-throw so Bull marks job as failed → sendEmailStrict surfaces 503
    }
  }

  @Process(REGISTER_EMAIL_JOB)
  async sendRegisterEmail(job: Job<Mail>) {
    await this.send(job, 'New Account', 'register-email');
  }

  @Process(RESET_PASSWORD_EMAIL_JOB)
  async sendResetPasswordEmail(job: Job<Mail>) {
    await this.send(job, 'Reset Your Password', 'reset-password-email');
  }

  @Process(PASSWORD_RESET_EMAIL_JOB)
  async sendPasswordResetSuccessEmail(job: Job<Mail>) {
    await this.send(
      job,
      'Your Password Has Been Reset',
      'password-reset-email',
    );
  }

  @Process(OTP_VERIFICATION_EMAIL_JOB)
  async sendOtpVerificationEmail(job: Job<Mail>) {
    await this.send(job, 'Account Verification', 'otp-verification-email');
  }

  @Process(INVITE_EMAIL_JOB)
  async sendInviteEmail(job: Job<Mail>) {
    await this.send(job, "You've been invited to ArchKalinga", 'invite-email');
  }

  @Process(ACCOUNT_LOCKED_EMAIL_JOB)
  async sendAccountLockedEmail(job: Job<Mail>) {
    await this.send(
      job,
      'Your Account Has Been Temporarily Locked',
      'account-locked-email',
    );
  }
}
