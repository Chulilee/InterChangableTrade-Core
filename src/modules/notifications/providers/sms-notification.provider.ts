import { Injectable } from '@nestjs/common';
import { Notification } from '../notification.class';
import { NotificationProvider } from './notification.provider';

@Injectable()
export class SmsNotificationProvider implements NotificationProvider {
  async send(notification: Notification): Promise<void> {
    console.log(
      `Sending SMS notification to ${notification.recipient}: ${notification.message}`,
    );
  }
}
