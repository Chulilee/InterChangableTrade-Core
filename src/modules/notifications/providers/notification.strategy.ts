import { Injectable } from '@nestjs/common';
import { Channel } from '../enums/channel.enum';
import { NotificationProvider } from './notification.provider';
import { WebSocketNotificationProvider } from './websocket-notification.provider';
import { EmailNotificationProvider } from './email-notification.provider';
import { SmsNotificationProvider } from './sms-notification.provider';

@Injectable()
export class NotificationStrategy {
  private providers: Map<Channel, NotificationProvider> = new Map();

  constructor(
    private readonly webSocketProvider: WebSocketNotificationProvider,
    private readonly emailProvider: EmailNotificationProvider,
    private readonly smsProvider: SmsNotificationProvider,
  ) {
    this.providers.set(Channel.WEB_SOCKET, this.webSocketProvider);
    this.providers.set(Channel.EMAIL, this.emailProvider);
    this.providers.set(Channel.SMS, this.smsProvider);
  }

  getProvider(channel: Channel): NotificationProvider {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new Error(`Provider for channel ${channel} not found`);
    }
    return provider;
  }
}
