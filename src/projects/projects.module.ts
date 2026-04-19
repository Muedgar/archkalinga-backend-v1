import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/common/common.module';
import { OutboxModule } from 'src/outbox/outbox.module';
import { ProjectPermissionGuard } from 'src/auth/guards';
import { WorkspacesModule } from 'src/workspaces/workspaces.module';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { Template, TemplateTask } from 'src/templates/entities';
import { User } from 'src/users/entities/user.entity';
import { Task, TaskActivityLog } from 'src/tasks/entities';
import {
  ProjectLabel,
  ProjectPriority,
  ProjectSeverity,
  ProjectStatus,
  ProjectTaskType,
} from 'src/tasks/project-config';
import {
  Project,
  ProjectActivityLog,
  ProjectInvite,
  ProjectMembership,
  ProjectRole,
} from './entities';
import { ProjectConfigController } from './project-config.controller';
import { ProjectConfigService } from './project-config.service';
import { ProjectRolesController } from './project-roles.controller';
import { ProjectRolesService } from './project-roles.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectMembership,
      ProjectInvite,
      ProjectRole,
      ProjectActivityLog,
      Workspace,
      WorkspaceMember,
      Template,
      TemplateTask,
      User,
      Task,
      TaskActivityLog,
      // Project config entities
      ProjectStatus,
      ProjectPriority,
      ProjectSeverity,
      ProjectTaskType,
      ProjectLabel,
    ]),
    CommonModule,
    OutboxModule,
    WorkspacesModule,
  ],
  controllers: [ProjectsController, ProjectRolesController, ProjectConfigController],
  providers: [ProjectsService, ProjectRolesService, ProjectConfigService, ProjectPermissionGuard],
  exports: [ProjectsService, ProjectConfigService, TypeOrmModule],
})
export class ProjectsModule {}
