import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/common/common.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { WorkspaceRole } from 'src/roles/roles.entity';
import { User } from 'src/users/entities/user.entity';
import {
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
} from 'src/workspaces/entities';

import { WorkspaceInvitesController } from './workspace-invites.controller';
import { WorkspaceInvitesService } from './workspace-invites.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkspaceInvite,
      WorkspaceMember,
      WorkspaceRole,
      Workspace,
      User,
    ]),
    CommonModule,
    NotificationsModule,
  ],
  controllers: [WorkspaceInvitesController],
  providers: [WorkspaceInvitesService],
  exports: [WorkspaceInvitesService],
})
export class WorkspaceInvitesModule {}
