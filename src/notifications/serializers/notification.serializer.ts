import { Expose } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';
import { NotificationType } from '../entities/notification.entity';

export class NotificationSerializer extends BaseSerializer {
  @Expose() userId: string;
  @Expose() type: NotificationType;
  @Expose() title: string;
  @Expose() body: string;
  @Expose() isRead: boolean;
  @Expose() readAt: Date | null;
  @Expose() meta: Record<string, unknown> | null;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
