import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RoleService } from './roles.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceRole } from './roles.entity';
import { CommonModule } from 'src/common/common.module';
import { WorkspacesModule } from 'src/workspaces/workspaces.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceRole]),
    CommonModule,
    WorkspacesModule,
  ],
  controllers: [RolesController],
  providers: [RoleService],
  exports: [RoleService, TypeOrmModule],
})
export class RolesModule {}
