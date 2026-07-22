import { Injectable } from '@nestjs/common';
import { Notification } from '../notification.class';
import { NotificationProvider } from './notification.provider';

@Injectable()
export class WebSocketNotificationProvider implements NotificationProvider {
  async send(notification: Notification): Promise<void> {
    console.log(
      `Sending WebSocket notification to ${notification.recipient}: ${notification.message}`,
    );
  }
}
