import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/common/common.module';
import { ProjectPermissionGuard } from 'src/auth/guards';
import { Organization } from 'src/organizations/entities/organization.entity';
import { Template, TemplateTask } from 'src/templates/entities';
import { User } from 'src/users/entities/user.entity';
import { Task, TaskActivityLog } from 'src/tasks/entities';
import { WorkflowColumn } from 'src/tasks/workflow';
import {
  Project,
  ProjectActivityLog,
  ProjectInvite,
  ProjectMembership,
  ProjectRole,
} from './entities';
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
      Organization,
      Template,
      TemplateTask,
      User,
      Task,
      TaskActivityLog,
      WorkflowColumn,
    ]),
    CommonModule,
  ],
  controllers: [ProjectsController, ProjectRolesController],
  providers: [ProjectsService, ProjectRolesService, ProjectPermissionGuard],
  exports: [ProjectsService, TypeOrmModule],
})
export class ProjectsModule {}
