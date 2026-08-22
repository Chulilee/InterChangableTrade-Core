import { Injectable } from '@nestjs/common';
import { Channel } from '../enums/channel.enum';
import { NotificationProvider } from './notification.provider';
import { WebSocketNotificationProvider } from './websocket-notification.provider';
import { EmailNotificationProvider } from './email-notification.provider';
import { SmsNotificationProvider } from './sms-notification.provider';
import { TelegramNotificationProvider } from './telegram-notification.provider';
import { DiscordNotificationProvider } from './discord-notification.provider';

@Injectable()
export class NotificationStrategy {
  private providers: Map<Channel, NotificationProvider> = new Map();

  constructor(
    private readonly webSocketProvider: WebSocketNotificationProvider,
    private readonly emailProvider: EmailNotificationProvider,
    private readonly smsProvider: SmsNotificationProvider,
    private readonly telegramProvider: TelegramNotificationProvider,
    private readonly discordProvider: DiscordNotificationProvider,
  ) {
    this.providers.set(Channel.WEB_SOCKET, this.webSocketProvider);
    this.providers.set(Channel.IN_APP, this.webSocketProvider);
    this.providers.set(Channel.EMAIL, this.emailProvider);
    this.providers.set(Channel.SMS, this.smsProvider);
    this.providers.set(Channel.TELEGRAM, this.telegramProvider);
    this.providers.set(Channel.DISCORD, this.discordProvider);
  }

  getProvider(channel: Channel): NotificationProvider {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new Error(`Provider for channel ${channel} not found`);
    }
    return provider;
  }
}