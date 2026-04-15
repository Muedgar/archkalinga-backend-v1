import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { GetUser } from 'src/auth/decorators';
import { JwtAuthGuard } from 'src/auth/guards';
import type { RequestUser } from 'src/auth/types';
import { ResponseMessage } from 'src/common/decorators';

import { ListNotificationsDto } from './dtos';
import {
  NOTIFICATION_DELETED,
  NOTIFICATION_MARKED_READ,
  NOTIFICATIONS_FETCHED,
  NOTIFICATIONS_MARKED_READ,
  UNREAD_COUNT_FETCHED,
} from './messages';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ── GET /notifications/unread-count ─────────────────────────────────────────
  //
  // Lightweight endpoint for badge polling — avoids fetching the full list.
  // Place BEFORE any :id route to prevent "unread-count" being parsed as a UUID.

  @Get('unread-count')
  @ResponseMessage(UNREAD_COUNT_FETCHED)
  @ApiOperation({ summary: 'Get the unread notification count for the current user' })
  @ApiResponse({ status: 200, description: '{ unreadCount: number }' })
  getUnreadCount(@GetUser() user: RequestUser) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  // ── GET /notifications ───────────────────────────────────────────────────────

  @Get()
  @ResponseMessage(NOTIFICATIONS_FETCHED)
  @ApiOperation({
    summary: 'List notifications for the current user',
    description:
      'Returns a paginated list of notifications. Pass isRead=false to fetch unread only. ' +
      'Response also includes a top-level unreadCount regardless of the isRead filter.',
  })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  @ApiQuery({ name: 'isRead', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Paginated notification list + unreadCount' })
  listNotifications(
    @GetUser() user: RequestUser,
    @Query() dto: ListNotificationsDto,
  ) {
    return this.notificationsService.listNotifications(user.id, dto);
  }

  // ── PATCH /notifications/read-all ───────────────────────────────────────────

  @Patch('read-all')
  @ResponseMessage(NOTIFICATIONS_MARKED_READ)
  @ApiOperation({ summary: 'Mark all notifications as read for the current user' })
  @ApiResponse({ status: 200, description: '{ updated: number }' })
  markAllAsRead(@GetUser() user: RequestUser) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  // ── PATCH /notifications/:notificationId/read ────────────────────────────────

  @Patch(':notificationId/read')
  @ResponseMessage(NOTIFICATION_MARKED_READ)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiResponse({ status: 200, description: 'Updated notification' })
  @ApiResponse({ status: 403, description: 'Notification belongs to another user' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  markAsRead(
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.notificationsService.markAsRead(notificationId, user.id);
  }

  // ── DELETE /notifications/:notificationId ────────────────────────────────────

  @Delete(':notificationId')
  @ResponseMessage(NOTIFICATION_DELETED)
  @ApiOperation({ summary: 'Delete a single notification' })
  @ApiResponse({ status: 200, description: '{ id, deleted: true }' })
  @ApiResponse({ status: 403, description: 'Notification belongs to another user' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  deleteNotification(
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @GetUser() user: RequestUser,
  ) {
    return this.notificationsService.deleteNotification(notificationId, user.id);
  }
}
