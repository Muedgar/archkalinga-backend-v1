import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { CommonModule } from './common/common.module';
import { TemplatesModule } from './templates/templates.module';
import { ProjectsModule } from './projects/projects.module';
import { ProjectInvitesModule } from './project-invites/project-invites.module';
import { TasksModule } from './tasks/tasks.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OutboxModule } from './outbox/outbox.module';

import { ResponseInterceptor } from './common/interceptors';
import { dataSourceOptions } from './config/db/db.config';

@Module({
  imports: [
    // ── Config ───────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── Database ─────────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (): TypeOrmModuleOptions => ({
        ...dataSourceOptions,
        autoLoadEntities: true,
        // Only synchronize in true local dev (local postgres). For remote DBs
        // (Railway, staging, prod) always use migrations to avoid concurrent
        // query warnings and accidental schema drift.
        synchronize: process.env.NODE_ENV === 'development',
      }),
    }),

    // ── Redis / Email Queue ───────────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        redis: {
          host: cfg.get<string>('REDIS_HOST', 'localhost'),
          port: cfg.get<number>('REDIS_PORT', 6379),
          password: cfg.get<string>('REDIS_PASSWORD'),
        },
      }),
    }),

    // ── Rate limiting ─────────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      { ttl: 60000, limit: 60 }, // 60 req/min default
    ]),

    // ── Feature modules ───────────────────────────────────────────────────────
    CommonModule,
    WorkspacesModule,
    RolesModule,
    UsersModule,
    AuthModule,
    TemplatesModule,
    ProjectsModule,
    ProjectInvitesModule,
    TasksModule,
    NotificationsModule,
    OutboxModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
