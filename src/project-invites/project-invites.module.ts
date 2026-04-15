import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectPermissionGuard } from 'src/auth/guards';
import { CommonModule } from 'src/common/common.module';
import {
  ProjectInvite,
  ProjectMembership,
  ProjectActivityLog,
  Project,
  ProjectRole,
} from 'src/projects/entities';
import { User } from 'src/users/entities/user.entity';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { WorkspaceRole } from 'src/roles/roles.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';

import { ProjectInvitesController } from './project-invites.controller';
import { ProjectInvitesService } from './project-invites.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectInvite,
      ProjectMembership,
      ProjectActivityLog,
      Project,
      ProjectRole,
      User,
      Workspace,
      WorkspaceMember,
      WorkspaceRole,
    ]),
    CommonModule,
    NotificationsModule,
  ],
  controllers: [ProjectInvitesController],
  providers: [ProjectInvitesService, ProjectPermissionGuard],
  exports: [ProjectInvitesService],
})
export class ProjectInvitesModule {}
