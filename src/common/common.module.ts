import { Module } from '@nestjs/common';
import {
  EmailService,
  AuditLogService,
  ListFilterService,
  MailHealthService,
} from './services';
import { EmailProcessor } from './processors';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { join } from 'path';
import { MAIL_QUEUE } from './constants';
import { AuditLog } from './entities/audit-log.entity';
import { MailHealthController } from './controllers/mail-health.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    BullModule.registerQueue({ name: MAIL_QUEUE }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        transport: {
          host: cfg.get<string>('MAIL_HOST', 'smtp.gmail.com'),
          port: cfg.get<number>('MAIL_PORT', 587),
          secure: false, // STARTTLS on port 587
          auth: {
            user: cfg.get<string>('MAIL_USER'),
            pass: cfg.get<string>('MAIL_PASSWORD'),
          },
        },
        defaults: {
          from: `"ArchKalinga" <${cfg.get<string>('MAIL_FROM_EMAIL')}>`,
        },
        template: {
          dir: join(__dirname, 'mail-templates'),
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
      }),
    }),
  ],
  controllers: [MailHealthController],
  providers: [
    EmailService,
    EmailProcessor,
    AuditLogService,
    ListFilterService,
    MailHealthService,
  ],
  exports: [
    EmailService,
    AuditLogService,
    ListFilterService,
    MailHealthService,
  ],
})
export class CommonModule {}
