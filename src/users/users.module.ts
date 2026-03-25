import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesModule } from 'src/roles/roles.module';
import { User, UserProfile } from './entities';
import { UserController } from './users.controller';
import { UserService } from './users.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserProfile]),
    RolesModule,
    CommonModule,
  ],
  controllers: [UserController, MeController],
  providers: [UserService, MeService],
  exports: [UserService, TypeOrmModule],
})
export class UsersModule {}
