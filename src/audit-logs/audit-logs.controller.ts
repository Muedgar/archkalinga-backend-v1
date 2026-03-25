import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, PermissionGuard } from 'src/auth/guards';
import { GetUser, RequirePermission } from 'src/auth/decorators';
import { ResponseMessage } from 'src/common/decorators';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { User } from 'src/users/entities';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequirePermission('userManagement', 'view')
  @ResponseMessage('Audit logs fetched successfully')
  @ApiOperation({ summary: 'List audit logs for the current organization (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated audit log entries with actor info' })
  @ApiResponse({ status: 401, description: 'Invalid or missing access token' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.view)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (default 50, max 200)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset (default 0)' })
  async findAll(
    @GetUser() user: User,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const [logs, total] = await this.auditLogService.findAll(
      user.organizationId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
    return { logs, total };
  }
}
