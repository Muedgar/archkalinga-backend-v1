import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from 'src/common/common.module';
import { Organization } from 'src/organizations/entities/organization.entity';
import { Project } from 'src/projects/entities';
import { Template, TemplateTask } from './entities';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Template, TemplateTask, Project, Organization]),
    CommonModule,
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService, TypeOrmModule],
})
export class TemplatesModule {}
