import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/common/common.module';
import { Organization } from 'src/organizations/entities/organization.entity';
import { Template } from 'src/templates/entities/template.entity';
import { User } from 'src/users/entities/user.entity';
import {
  Project,
  ProjectActivityLog,
  ProjectInvite,
  ProjectMembership,
} from './entities';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectMembership,
      ProjectInvite,
      ProjectActivityLog,
      Organization,
      Template,
      User,
    ]),
    CommonModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService, TypeOrmModule],
})
export class ProjectsModule {}
