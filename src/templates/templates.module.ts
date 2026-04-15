import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/common/common.module';
import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { Project } from 'src/projects/entities';
import { Template, TemplateTask } from './entities';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { WorkspacesModule } from 'src/workspaces/workspaces.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Template, TemplateTask, Project, Workspace]),
    CommonModule,
    WorkspacesModule,
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService, TypeOrmModule],
})
export class TemplatesModule {}
