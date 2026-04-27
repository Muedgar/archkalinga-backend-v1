import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectPermissionGuard } from 'src/auth/guards';
import { CommonModule } from 'src/common/common.module';
import { OutboxModule } from 'src/outbox/outbox.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import {
  Project,
  ProjectActivityLog,
  ProjectInvite,
  ProjectMembership,
  ProjectRole,
} from 'src/projects/entities';
import { User } from 'src/users/entities';
import {
  ProjectLabel,
  ProjectPriority,
  ProjectSeverity,
  ProjectStatus,
  ProjectTaskType,
} from './project-config';
import {
  Task,
  TaskActivityLog,
  TaskAssignee,
  TaskChecklist,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskLabel,
  TaskRelation,
  TaskViewMetadata,
  TaskWatcher,
} from './entities';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import {
  TaskActivityService,
  TaskAuthService,
  TaskChecklistService,
  TaskCommentsService,
  TaskCrudService,
  TaskMembersService,
  TaskQueryService,
  TaskRankingService,
  TaskRelationsService,
} from './services';

const SUB_SERVICES = [
  TaskAuthService,
  TaskActivityService,
  TaskRankingService,
  TaskCommentsService,
  TaskChecklistService,
  TaskRelationsService,
  TaskMembersService,
  TaskCrudService,
  TaskQueryService,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      TaskAssignee,
      TaskChecklist,
      TaskChecklistItem,
      TaskComment,
      TaskDependency,
      TaskLabel,
      TaskRelation,
      TaskViewMetadata,
      TaskWatcher,
      TaskActivityLog,
      Project,
      ProjectInvite,
      ProjectMembership,
      ProjectRole,
      ProjectActivityLog,
      User,
      ProjectStatus,
      ProjectPriority,
      ProjectSeverity,
      ProjectTaskType,
      ProjectLabel,
    ]),
    CommonModule,
    NotificationsModule,
    OutboxModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, ProjectPermissionGuard, ...SUB_SERVICES],
  exports: [TasksService],
})
export class TasksModule {}
