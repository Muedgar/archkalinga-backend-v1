import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';

import { Notification, NotificationType } from './entities/notification.entity';
import { ListNotificationsDto } from './dtos';
import { NotificationSerializer } from './serializers/notification.serializer';
import { NotificationsGateway } from './notifications.gateway';
import { NOTIFICATION_NOT_FOUND } from './messages';

// ── Internal shape used by other services when creating notifications ──────────
export interface CreateNotificationPayload {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,

    private readonly gateway: NotificationsGateway,
  ) {}

  // ---------------------------------------------------------------------------
  // Internal helper (called by other services, e.g. ProjectInvitesService)
  // ---------------------------------------------------------------------------

  async createNotification(
    payload: CreateNotificationPayload,
  ): Promise<Notification> {
    const notification = this.notificationRepo.create({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      isRead: false,
      readAt: null,
      meta: payload.meta ?? null,
    });
    const saved = await this.notificationRepo.save(notification);

    // Push live event to all active sockets for this user
    const serialized = this.toSerializer(saved);
    this.gateway.pushNotification(payload.userId, serialized);

    return saved;
  }

  // ---------------------------------------------------------------------------
  // List notifications for the current user
  // ---------------------------------------------------------------------------

  async listNotifications(
    userId: string,
    dto: ListNotificationsDto,
  ): Promise<{ items: NotificationSerializer[]; count: number; unreadCount: number }> {
    const { page, limit, isRead } = dto;

    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .orderBy('n.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (isRead !== undefined) {
      qb.andWhere('n.isRead = :isRead', { isRead });
    }

    const [notifications, count] = await qb.getManyAndCount();

    // Fetch global unread count for badge (regardless of isRead filter)
    const unreadCount = await this.notificationRepo.count({
      where: { userId, isRead: false },
    });

    return {
      items: notifications.map((n) => this.toSerializer(n)),
      count,
      unreadCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Unread count (lightweight badge poll)
  // ---------------------------------------------------------------------------

  async getUnreadCount(userId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.notificationRepo.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  // ---------------------------------------------------------------------------
  // Mark one notification as read
  // ---------------------------------------------------------------------------

  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<NotificationSerializer> {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });

    if (!notification) throw new NotFoundException(NOTIFICATION_NOT_FOUND);
    if (notification.userId !== userId) throw new ForbiddenException();

    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await this.notificationRepo.save(notification);
    }

    const unreadCount = await this.notificationRepo.count({
      where: { userId, isRead: false },
    });

    // Push live: badge count update + individual read event
    this.gateway.pushNotificationRead(userId, notificationId, unreadCount);

    return this.toSerializer(notification);
  }

  // ---------------------------------------------------------------------------
  // Mark all notifications as read
  // ---------------------------------------------------------------------------

  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationRepo
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true, readAt: () => 'NOW()' })
      .where('userId = :userId AND isRead = false', { userId })
      .execute();

    const updated = result.affected ?? 0;

    // Push live: all-read event with final count of 0
    if (updated > 0) {
      this.gateway.pushAllRead(userId, updated);
    }

    return { updated };
  }

  // ---------------------------------------------------------------------------
  // Delete a single notification
  // ---------------------------------------------------------------------------

  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<{ id: string; deleted: true }> {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });

    if (!notification) throw new NotFoundException(NOTIFICATION_NOT_FOUND);
    if (notification.userId !== userId) throw new ForbiddenException();

    await this.notificationRepo.remove(notification);

    // Push live: remove from client list
    this.gateway.pushNotificationDeleted(userId, notificationId);

    return { id: notificationId, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private toSerializer(n: Notification): NotificationSerializer {
    return plainToInstance(NotificationSerializer, n, {
      excludeExtraneousValues: true,
    });
  }
}
