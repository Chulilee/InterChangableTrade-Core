import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '../notification.class';
import { NotificationProvider } from './notification.provider';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class WebSocketNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(WebSocketNotificationProvider.name);

  constructor(private readonly gateway: NotificationGateway) {}

  async send(notification: Notification): Promise<void> {
    const payload = {
      id: crypto.randomUUID(),
      type: notification.type,
      title: notification.title ?? notification.type,
      message: notification.message,
      metadata: notification.metadata ?? null,
      createdAt: new Date(),
    };

    this.gateway.sendToUser(notification.recipient, payload);
    this.logger.log(
      `WebSocket notification sent to user ${notification.recipient}`,
    );
  }
}
