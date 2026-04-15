import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),

    /**
     * JwtModule is needed by NotificationsGateway to verify the bearer
     * token that clients send on WebSocket handshake.
     * Must match the secret used in AuthModule.
     */
    JwtModule.registerAsync({
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('SECRET_KEY'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsGateway,
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
