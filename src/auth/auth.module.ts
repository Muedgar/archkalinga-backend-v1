import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, UserProfile } from 'src/users/entities';
import { UsersModule } from 'src/users/users.module';
import { JwtStrategy } from './strategies';
import { ReauthGuard } from './guards';
import { CommonModule } from 'src/common/common.module';
import { UserSession } from './entities/user-session.entity';
import { Organization } from 'src/organizations/entities/organization.entity';
import { Role } from 'src/roles/roles.entity';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('SECRET_KEY'),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([
      User,
      UserProfile,
      UserSession,
      Organization,
      Role,
    ]),
    UsersModule,
    CommonModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ReauthGuard],
  exports: [AuthService],
})
export class AuthModule {}
