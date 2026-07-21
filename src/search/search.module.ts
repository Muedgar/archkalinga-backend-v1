import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project, ProjectMembership, ProjectRole } from 'src/projects/entities';
import { Task, TaskAssignee } from 'src/tasks/entities';
import { User } from 'src/users/entities';
import { WorkspacesModule } from 'src/workspaces/workspaces.module';
import { SearchRecentItem } from './entities';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectMembership,
      ProjectRole,
      Task,
      TaskAssignee,
      User,
      SearchRecentItem,
    ]),
    WorkspacesModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
