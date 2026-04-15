import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from 'src/common/entities/audit-log.entity';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { AuditLogsController } from './audit-logs.controller';
import { WorkspacesModule } from 'src/workspaces/workspaces.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    WorkspacesModule,
  ],
  providers: [AuditLogService],
  controllers: [AuditLogsController],
})
export class AuditLogsModule {}
