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
import { Task } from 'src/tasks/entities/task.entity';
import { TaskAssignee } from 'src/tasks/entities/task-assignee.entity';
import { User } from 'src/users/entities/user.entity';

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
      Task,
      TaskAssignee,
      User,
    ]),
    CommonModule,
  ],
  controllers: [ProjectInvitesController],
  providers: [ProjectInvitesService, ProjectPermissionGuard],
  exports: [ProjectInvitesService],
})
export class ProjectInvitesModule {}
