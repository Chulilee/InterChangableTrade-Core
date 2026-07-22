import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification as NotificationEntity } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Notification } from './notification.class';
import { NotificationStrategy } from './providers/notification.strategy';
import { Channel } from './enums/channel.enum';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(NotificationPreference)
    private readonly notificationPreferenceRepository: Repository<NotificationPreference>,
    @InjectRepository(NotificationTemplate)
    private readonly notificationTemplateRepository: Repository<NotificationTemplate>,
    private readonly notificationStrategy: NotificationStrategy,
  ) {}

  async send(notification: Notification): Promise<void> {
    const userPreference = await this.notificationPreferenceRepository.findOne({
      where: {
        userId: notification.recipient,
        channel: notification.channel,
      },
    });

    if (userPreference && !userPreference.isEnabled) {
      return; // User has disabled this channel
    }

    await this.notificationRepository.save({
      recipient: notification.recipient,
      channel: notification.channel,
      message: notification.message,
    });

    const provider = this.notificationStrategy.getProvider(
      notification.channel,
    );

    let attempts = 0;
    const maxAttempts = 5;
    let delay = 1000;

    while (attempts < maxAttempts) {
      try {
        await provider.send(notification);
        return; // Success
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) {
          // Log the final failure
          console.error(
            `Failed to send notification after ${maxAttempts} attempts`,
            error,
          );
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
  }

  async createTemplate(
    name: string,
    template: string,
  ): Promise<NotificationTemplate> {
    const newTemplate = this.notificationTemplateRepository.create({
      name,
      template,
    });
    return this.notificationTemplateRepository.save(newTemplate);
  }

  async sendFromTemplate(
    templateName: string,
    channel: Channel,
    recipient: string,
    data: Record<string, any>,
  ): Promise<void> {
    const template = await this.notificationTemplateRepository.findOne({
      where: { name: templateName },
    });
    if (!template) {
      throw new NotFoundException(
        `Template with name ${templateName} not found`,
      );
    }

    const message = this.renderTemplate(template.template, data);
    const notification = new Notification(channel, recipient, message);
    await this.send(notification);
  }

  private renderTemplate(template: string, data: Record<string, any>): string {
    return template.replace(/{{(\w+)}}/g, (placeholder, key) => {
      return data[key] || placeholder;
    });
  }

  async search(searchDto: any): Promise<NotificationEntity[]> {
    const query =
      this.notificationRepository.createQueryBuilder('notification');

    if (searchDto.userId) {
      query.andWhere('notification.recipient = :userId', {
        userId: searchDto.userId,
      });
    }

    if (searchDto.channel) {
      query.andWhere('notification.channel = :channel', {
        channel: searchDto.channel,
      });
    }

    if (searchDto.startDate) {
      query.andWhere('notification.createdAt >= :startDate', {
        startDate: searchDto.startDate,
      });
    }

    if (searchDto.endDate) {
      query.andWhere('notification.createdAt <= :endDate', {
        endDate: searchDto.endDate,
      });
    }

    return query.getMany();
  }

  async getUserPreferences(userId: string): Promise<NotificationPreference[]> {
    return this.notificationPreferenceRepository.find({ where: { userId } });
  }

  async updateUserPreference(
    userId: string,
    channel: Channel,
    isEnabled: boolean,
  ): Promise<NotificationPreference> {
    let preference = await this.notificationPreferenceRepository.findOne({
      where: { userId, channel },
    });

    if (preference) {
      preference.isEnabled = isEnabled;
    } else {
      preference = this.notificationPreferenceRepository.create({
        userId,
        channel,
        isEnabled,
      });
    }

    return this.notificationPreferenceRepository.save(preference);
  }
}
