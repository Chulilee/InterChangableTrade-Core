import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '../notification.class';
import { NotificationProvider } from './notification.provider';
import { Channel } from '../enums/channel.enum';
import { ConfigService } from '@nestjs/config';
import { WebhookClient, EmbedBuilder } from 'discord.js';

@Injectable()
export class DiscordNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(DiscordNotificationProvider.name);
  private webhookClient: WebhookClient | null = null;
  readonly channel = Channel.DISCORD;

  constructor(private configService: ConfigService) {
    this.initializeWebhook();
  }

  private initializeWebhook() {
    const webhookUrl = this.configService.get<string>('DISCORD_WEBHOOK_URL');
    if (webhookUrl) {
      try {
        // Extract webhook ID and token from URL
        const urlParts = webhookUrl.split('/');
        const id = urlParts[urlParts.length - 2];
        const token = urlParts[urlParts.length - 1];

        this.webhookClient = new WebhookClient({ id, token });
        this.logger.log('🎮 Discord notification provider initialized');
      } catch (error) {
        this.logger.error('Failed to initialize Discord webhook', error);
      }
    } else {
      this.logger.warn(
        '⚠️ Discord webhook URL not configured, provider disabled',
      );
    }
  }

  async send(notification: Notification): Promise<void> {
    if (!this.webhookClient) {
      this.logger.warn(
        'Cannot send Discord notification: webhook not initialized',
      );
      return;
    }

    try {
      const embed = this.createEmbed(notification);
      await this.webhookClient.send({ embeds: [embed] });

      this.logger.log(`💬 Discord notification sent`);
    } catch (error) {
      this.logger.error('Failed to send Discord notification', error);
    }
  }

  private createEmbed(notification: Notification): EmbedBuilder {
    const { title, message, templateData } = notification;
    const severity = notification.metadata?.severity || 'medium';

    const embed = new EmbedBuilder()
      .setTitle(title || 'Notification from InterChangableTrade')
      .setDescription(message || '')
      .setTimestamp();

    // Set color based on severity
    switch (severity) {
      case 'critical':
        embed.setColor(0xff0000); // Red
        break;
      case 'high':
        embed.setColor(0xffa500); // Orange
        break;
      case 'medium':
        embed.setColor(0xffff00); // Yellow
        break;
      default:
        embed.setColor(0x00ff00); // Green
    }

    // Add additional fields if templateData is present
    if (templateData && typeof templateData === 'object') {
      for (const [key, value] of Object.entries(templateData)) {
        embed.addFields({ name: key, value: String(value), inline: true });
      }
    }

    return embed;
  }
}
