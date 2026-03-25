import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from 'src/common/entities/audit-log.entity';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { AuditLogsController } from './audit-logs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
  ],
  providers: [AuditLogService],
  controllers: [AuditLogsController],
})
export class AuditLogsModule {}
