/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { InjectQueue } from '@nestjs/bull';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Job, Queue } from 'bull';

import { ConfigService } from '@nestjs/config';
import { MAIL_QUEUE } from '../constants';
import { Mail } from '../interfaces';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
    private configService: ConfigService,
  ) {}

  private withMailDefaults(data: Mail): Mail {
    return {
      ...data,
      data: {
        ...data.data,
        year: new Date().getFullYear(),
        clientUrl: this.configService.get('CLIENT_URL'),
      },
    };
  }

  private isSendMailEnabled(): { enabled: boolean; raw: string | undefined } {
    const raw = this.configService.get<string>('SEND_MAIL');
    const enabled = ['true', '1', 'yes', 'on'].includes(
      String(raw).toLowerCase(),
    );
    return { enabled, raw };
  }

  private async waitForCompletion(job: Job, timeoutMs: number): Promise<void> {
    await Promise.race([
      job.finished().then(() => undefined),
      new Promise<void>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Mail job ${job.id} timed out after ${timeoutMs}ms`),
            ),
          timeoutMs,
        ),
      ),
    ]);
  }

  async sendEmail(data: Mail, jobName: string) {
    data = this.withMailDefaults(data);
    const { enabled, raw } = this.isSendMailEnabled();

    if (enabled) {
      const job = await this.mailQueue.add(jobName, data);
      return { jobId: job.id };
    }

    this.logger.warn(
      `Email dispatch skipped because SEND_MAIL=${raw ?? 'undefined'}`,
    );
  }

  async sendEmailStrict(
    data: Mail,
    jobName: string,
    timeoutMs = 15000,
  ): Promise<{ jobId: string | number }> {
    data = this.withMailDefaults(data);
    const { enabled, raw } = this.isSendMailEnabled();

    if (!enabled) {
      throw new ServiceUnavailableException(
        `Email dispatch disabled (SEND_MAIL=${raw ?? 'undefined'}).`,
      );
    }

    const job = await this.mailQueue.add(jobName, data);
    try {
      await this.waitForCompletion(job, timeoutMs);
      return { jobId: job.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Email job ${job.id} (${jobName}) failed for ${data.to}: ${message}`,
      );
      throw new ServiceUnavailableException(
        `Email dispatch failed for ${data.to}.`,
      );
    }
  }
}
