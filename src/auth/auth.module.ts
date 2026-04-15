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
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { WorkspaceRole } from 'src/roles/roles.entity';

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
      Workspace,
      WorkspaceMember,
      WorkspaceRole,
    ]),
    UsersModule,
    CommonModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ReauthGuard],
  exports: [AuthService],
})
export class AuthModule {}
