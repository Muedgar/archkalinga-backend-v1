import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, PermissionGuard } from 'src/auth/guards';
import { RequirePermission } from 'src/auth/decorators';
import { WorkspaceGuard } from 'src/workspaces/guards/workspace.guard';
import { GetWorkspaceMember } from 'src/workspaces/decorators/get-workspace-member.decorator';
import type { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { ResponseMessage } from 'src/common/decorators';
import { AuditLogService } from 'src/common/services/audit-log.service';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard, PermissionGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequirePermission('userManagement', 'view')
  @ResponseMessage('Audit logs fetched successfully')
  @ApiOperation({ summary: 'List audit logs for the current workspace (admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated audit log entries with actor info' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions (requires userManagement.view)' })
  @ApiQuery({ name: 'limit',  required: false, type: Number, description: 'Page size (default 50, max 200)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset (default 0)' })
  async findAll(
    @GetWorkspaceMember() member: WorkspaceMember,
    @Query('limit')  limit?: string,
    @Query('offset') offset?: string,
  ) {
    const [logs, total] = await this.auditLogService.findAll(
      member.workspaceId,
      limit  ? parseInt(limit,  10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
    return { logs, total };
  }
}
