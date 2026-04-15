import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesModule } from 'src/roles/roles.module';
import { WorkspacesModule } from 'src/workspaces/workspaces.module';
import { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { User, UserProfile } from './entities';
import { UserController } from './users.controller';
import { UserService } from './users.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserProfile, WorkspaceMember]),
    RolesModule,
    WorkspacesModule,
    CommonModule,
  ],
  controllers: [UserController, MeController],
  providers: [UserService, MeService],
  exports: [UserService, TypeOrmModule],
})
export class UsersModule {}
