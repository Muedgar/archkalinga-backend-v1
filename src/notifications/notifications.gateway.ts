import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

import type { JwtPayload } from 'src/auth/interfaces';
import type { NotificationSerializer } from './serializers/notification.serializer';

/** Events emitted to connected clients */
export const NOTIFICATION_EVENTS = {
  /** Server → client: a new notification was created for this user */
  NEW_NOTIFICATION: 'notification:new',
  /** Server → client: one notification was marked read */
  NOTIFICATION_READ: 'notification:read',
  /** Server → client: all notifications were marked read */
  ALL_READ: 'notification:all_read',
  /** Server → client: a notification was deleted */
  NOTIFICATION_DELETED: 'notification:deleted',
  /** Server → client: unread count refreshed */
  UNREAD_COUNT: 'notification:unread_count',
} as const;

/**
 * WebSocket gateway for real-time notification delivery.
 *
 * Namespace:  /notifications
 * Auth:       JWT sent via handshake auth token
 *             Client connects with:
 *               io('/notifications', { auth: { token: 'Bearer <access_token>' } })
 *
 * Multi-tab:  One user can have multiple simultaneous sockets.
 *             The registry maps userId → Set<Socket> so events reach every tab.
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: '*',   // tighten to your frontend origin in production
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  /** userId → Set of connected sockets (multi-tab support) */
  private readonly userSockets = new Map<string, Set<Socket>>();

  constructor(private readonly jwtService: JwtService) {}

  afterInit() {
    this.logger.log('NotificationsGateway initialised on namespace /notifications');
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  async handleConnection(socket: Socket) {
    try {
      const userId = this.authenticateSocket(socket);
      this.registerSocket(userId, socket);
      this.logger.debug(`Socket connected: ${socket.id} (user: ${userId})`);
    } catch {
      // Invalid or missing token — disconnect immediately
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    const userId = (socket as any).__userId as string | undefined;
    if (userId) {
      this.unregisterSocket(userId, socket);
      this.logger.debug(`Socket disconnected: ${socket.id} (user: ${userId})`);
    }
  }

  // ---------------------------------------------------------------------------
  // Push helpers (called by NotificationsService)
  // ---------------------------------------------------------------------------

  /**
   * Push a new notification to all sockets belonging to `userId`.
   * Safe to call even when the user has no active connections.
   */
  pushNotification(userId: string, notification: NotificationSerializer): void {
    this.emitToUser(userId, NOTIFICATION_EVENTS.NEW_NOTIFICATION, notification);
  }

  /** Tell all user sockets that a specific notification was read. */
  pushNotificationRead(userId: string, notificationId: string, unreadCount: number): void {
    this.emitToUser(userId, NOTIFICATION_EVENTS.NOTIFICATION_READ, {
      id: notificationId,
      unreadCount,
    });
  }

  /** Tell all user sockets that all notifications were marked read. */
  pushAllRead(userId: string, updated: number): void {
    this.emitToUser(userId, NOTIFICATION_EVENTS.ALL_READ, { updated, unreadCount: 0 });
  }

  /** Tell all user sockets that a notification was deleted. */
  pushNotificationDeleted(userId: string, notificationId: string): void {
    this.emitToUser(userId, NOTIFICATION_EVENTS.NOTIFICATION_DELETED, {
      id: notificationId,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private authenticateSocket(socket: Socket): string {
    // Accept token from: handshake.auth.token, handshake.headers.authorization,
    // or handshake.query.token (fallback for environments that can't set custom headers)
    const raw: string | undefined =
      (socket.handshake.auth as Record<string, string>)?.token ||
      (socket.handshake.headers.authorization as string | undefined) ||
      (socket.handshake.query.token as string | undefined);

    if (!raw) throw new Error('No token provided');

    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    const payload = this.jwtService.verify<JwtPayload>(token);

    if (!payload?.id) throw new Error('Invalid token payload');

    // Attach userId to the socket for disconnect lookup
    (socket as any).__userId = payload.id;
    return payload.id;
  }

  private registerSocket(userId: string, socket: Socket): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socket);
  }

  private unregisterSocket(userId: string, socket: Socket): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) this.userSockets.delete(userId);
  }

  private emitToUser(userId: string, event: string, data: unknown): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets?.size) return; // user not online — skip silently
    for (const socket of sockets) {
      socket.emit(event, data);
    }
  }
}
