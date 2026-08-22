
import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '../notification.class';
import { NotificationProvider } from './notification.provider';
import { Channel } from '../enums/channel.enum';
import { ConfigService } from '@nestjs/config';
@Injectable()
export class TelegramNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(TelegramNotificationProvider.name);
  private bot: any = null;
  readonly channel = Channel.TELEGRAM;

  constructor(private configService: ConfigService) {
    this.initializeBot();
  }

  private initializeBot() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (token) {
      // Dynamically import TelegramBot to avoid TypeScript issues
      import('node-telegram-bot-api').then(({ default: TelegramBot }) => {
        const TelegramBotConstructor: any = TelegramBot;
        this.bot = new TelegramBotConstructor(token, { polling: false });
        this.logger.log('🤖 Telegram notification provider initialized');
      }).catch(err => {
        this.logger.error('Failed to load TelegramBot', err);
      });
    } else {
      this.logger.warn('⚠️ Telegram bot token not configured, provider disabled');
    }
  }

  async send(notification: Notification): Promise<void> {
    if (!this.bot) {
      this.logger.warn('Cannot send Telegram notification: bot not initialized');
      return;
    }

    try {
      const chatId = this.extractChatId(notification.recipient);
      const message = this.formatMessage(notification);
      
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      });
      
      this.logger.log(`📱 Telegram notification sent to ${chatId}`);
    } catch (error) {
      this.logger.error('Failed to send Telegram notification', error);
    }
  }

  private extractChatId(recipient: string): string {
    // Recipient format could be "telegram:123456789" or just the chat ID
    return recipient.includes(':') ? recipient.split(':')[1] : recipient;
  }

  private formatMessage(notification: Notification): string {
    const { title, message, templateData } = notification;
    
    let formattedMessage = `**${title}**\n\n${message}`;
    
    if (templateData) {
      formattedMessage += '\n\n---\n*Additional Details:*\n';
      for (const [key, value] of Object.entries(templateData)) {
        formattedMessage += `• ${key}: ${value}\n`;
      }
    }
    
    return formattedMessage;
  }
}