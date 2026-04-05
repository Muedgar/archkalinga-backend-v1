import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectPermissionGuard } from 'src/auth/guards';
import { CommonModule } from 'src/common/common.module';
import {
  Project,
  ProjectActivityLog,
  ProjectMembership,
} from 'src/projects/entities';
import { User } from 'src/users/entities';
import {
  Task,
  TaskActivityLog,
  TaskAssignee,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskViewMetadata,
} from './entities';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { WorkflowColumn } from './workflow';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      WorkflowColumn,
      TaskAssignee,
      TaskChecklistItem,
      TaskComment,
      TaskDependency,
      TaskViewMetadata,
      TaskActivityLog,
      Project,
      ProjectMembership,
      ProjectActivityLog,
      User,
    ]),
    CommonModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, ProjectPermissionGuard],
  exports: [TasksService],
})
export class TasksModule {}
