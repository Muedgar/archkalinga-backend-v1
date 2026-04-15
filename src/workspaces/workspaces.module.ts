import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspaceGuard } from './guards/workspace.guard';
import { WorkspacesService } from './workspaces.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Workspace, WorkspaceMember])],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceGuard],
  exports: [WorkspacesService, WorkspaceGuard, TypeOrmModule],
})
export class WorkspacesModule {}
