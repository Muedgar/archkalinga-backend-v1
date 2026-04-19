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
      ProjectActivityLog,
      User,
      // Project config entities (needed for status/priority/type validation in tasks)
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
  providers: [TasksService, ProjectPermissionGuard],
  exports: [TasksService],
})
export class TasksModule {}
