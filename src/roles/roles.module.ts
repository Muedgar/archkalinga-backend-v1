import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RoleService } from './roles.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './roles.entity';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [TypeOrmModule.forFeature([Role]), CommonModule],
  controllers: [RolesController],
  providers: [RoleService],
  exports: [RoleService, TypeOrmModule],
})
export class RolesModule {}
