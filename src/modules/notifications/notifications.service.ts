import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Notification as NotificationEntity } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Notification } from './notification.class';
import { NotificationStrategy } from './providers/notification.strategy';
import { NotificationGateway } from './providers/notification.gateway';
import { Channel } from './enums/channel.enum';
import { DeliveryStatus } from './enums/delivery-status.enum';
import { NotificationType } from './enums/notification-type.enum';
import { PaginationQueryDto, PaginatedResultDto } from '@app/common';
import { SearchNotificationsDto } from './dto/search-notifications.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Maximum retry attempts per notification delivery (requirement: 3) */
  private static readonly MAX_RETRIES = 3;
  /** Base delay in ms before first retry */
  private static readonly BASE_RETRY_DELAY_MS = 500;

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
    @InjectRepository(NotificationTemplate)
    private readonly templateRepository: Repository<NotificationTemplate>,
    private readonly strategy: NotificationStrategy,
    private readonly gateway: NotificationGateway,
  ) {}

  // ─── Core send ────────────────────────────────────────────────────────

  /**
   * Send a notification through the appropriate channel with retry logic.
   */
  async send(notification: Notification): Promise<NotificationEntity | null> {
    // Check per-channel preference
    const preference = await this.preferenceRepository.findOne({
      where: {
        userId: notification.recipient,
        channel: notification.channel,
      },
    });

    if (preference && !preference.isEnabled) {
      this.logger.debug(
        `User ${notification.recipient} has disabled channel ${notification.channel} — skipping`,
      );
      return null;
    }

    // Check per-type preference
    if (
      preference &&
      preference.subscribedTypes &&
      !preference.subscribedTypes.includes(notification.type)
    ) {
      this.logger.debug(
        `User ${notification.recipient} not subscribed to type ${notification.type} on ${notification.channel} — skipping`,
      );
      return null;
    }

    // Persist the notification record
    const entity = this.notificationRepository.create({
      recipient: notification.recipient,
      channel: notification.channel,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      metadata: notification.metadata,
      deliveryStatus: DeliveryStatus.PENDING,
      scheduledAt: notification.scheduledAt,
      batchId: notification.batchId,
    });
    const saved = await this.notificationRepository.save(entity);

    // If scheduled for the future, don't deliver now
    if (notification.scheduledAt && notification.scheduledAt > new Date()) {
      saved.deliveryStatus = DeliveryStatus.SCHEDULED;
      await this.notificationRepository.save(saved);
      this.logger.log(
        `Notification ${saved.id} scheduled for ${notification.scheduledAt.toISOString()}`,
      );
      return saved;
    }

    // Attempt delivery with retries
    await this.deliverWithRetry(saved, notification);

    return saved;
  }

  // ─── Retry logic ─────────────────────────────────────────────────────

  private async deliverWithRetry(
    entity: NotificationEntity,
    notification: Notification,
  ): Promise<void> {
    const provider = this.strategy.getProvider(entity.channel);

    for (let attempt = 1; attempt <= NotificationsService.MAX_RETRIES; attempt++) {
      try {
        await provider.send(notification);
        entity.deliveryStatus = DeliveryStatus.SENT;
        entity.retryCount = attempt - 1;
        await this.notificationRepository.save(entity);
        return;
      } catch (error) {
        entity.retryCount = attempt;
        this.logger.error(
          `Delivery attempt ${attempt}/${NotificationsService.MAX_RETRIES} failed for notification ${entity.id}`,
          (error as Error).stack,
        );

        if (attempt < NotificationsService.MAX_RETRIES) {
          entity.deliveryStatus = DeliveryStatus.RETRYING;
          await this.notificationRepository.save(entity);
          const delay =
            NotificationsService.BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          entity.deliveryStatus = DeliveryStatus.FAILED;
          await this.notificationRepository.save(entity);
          this.logger.error(
            `Notification ${entity.id} permanently failed after ${NotificationsService.MAX_RETRIES} attempts`,
          );
        }
      }
    }
  }

  // ─── Batch delivery ───────────────────────────────────────────────────

  async sendBatch(
    channel: Channel,
    type: NotificationType,
    items: Array<{
      recipient: string;
      message: string;
      title?: string;
      metadata?: Record<string, any>;
    }>,
  ): Promise<{ batchId: string; sent: number; skipped: number }> {
    const batchId = crypto.randomUUID();
    let sent = 0;
    let skipped = 0;

    // Pre-check all preferences for this channel/type
    const recipients = items.map((i) => i.recipient);
    const preferences = await this.preferenceRepository.find({
      where: recipients.map((userId) => ({ userId, channel })),
    });
    const preferenceMap = new Map(
      preferences.map((p) => [p.userId, p]),
    );

    // Persist all notification entities first for audit
    const entities = items.map((item) => {
      const pref = preferenceMap.get(item.recipient);
      const isDisabled = pref && !pref.isEnabled;
      const isUnsubscribed =
        pref &&
        pref.subscribedTypes &&
        !pref.subscribedTypes.includes(type);

      return this.notificationRepository.create({
        recipient: item.recipient,
        channel,
        type,
        title: item.title,
        message: item.message,
        metadata: item.metadata,
        batchId,
        deliveryStatus:
          isDisabled || isUnsubscribed
            ? DeliveryStatus.FAILED
            : DeliveryStatus.PENDING,
      });
    });

    const saved = await this.notificationRepository.save(entities);
    const provider = this.strategy.getProvider(channel);

    // Deliver concurrently (limit to avoid overload)
    const CONCURRENCY = 10;
    const pending = saved.filter(
      (e) => e.deliveryStatus === DeliveryStatus.PENDING,
    );

    skipped = saved.length - pending.length;

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (entity) => {
          const notification = new Notification(channel, entity.recipient, entity.message, {
            type,
            title: entity.title,
            metadata: entity.metadata ?? undefined,
            batchId,
          });

          for (let attempt = 1; attempt <= NotificationsService.MAX_RETRIES; attempt++) {
            try {
              await provider.send(notification);
              entity.deliveryStatus = DeliveryStatus.SENT;
              await this.notificationRepository.save(entity);
              return;
            } catch (err) {
              entity.retryCount = attempt;
              if (attempt === NotificationsService.MAX_RETRIES) {
                entity.deliveryStatus = DeliveryStatus.FAILED;
                await this.notificationRepository.save(entity);
                this.logger.error(
                  `Batch notification ${entity.id} failed after ${NotificationsService.MAX_RETRIES} attempts`,
                );
              } else {
                await new Promise((r) =>
                  setTimeout(r, NotificationsService.BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1)),
                );
              }
            }
          }
        }),
      );

      sent += results.filter((r) => r.status === 'fulfilled').length;
    }

    this.logger.log(
      `Batch ${batchId}: sent=${sent}, skipped=${skipped}, total=${items.length}`,
    );

    return { batchId, sent, skipped };
  }

  // ─── Scheduled notifications ──────────────────────────────────────────

  /**
   * Process notifications that are scheduled for delivery now or in the past.
   * Intended to be called periodically by a cron/scheduler.
   */
  async processScheduledNotifications(): Promise<number> {
    const due = await this.notificationRepository.find({
      where: {
        deliveryStatus: DeliveryStatus.SCHEDULED,
        scheduledAt: In([new Date(/* use <= via query */)]) as any,
      },
    });

    // Use a query builder for the <= comparison
    const dueNotifications = await this.notificationRepository
      .createQueryBuilder('n')
      .where('n.deliveryStatus = :status', {
        status: DeliveryStatus.SCHEDULED,
      })
      .andWhere('n.scheduledAt <= :now', { now: new Date() })
      .getMany();

    let processed = 0;
    for (const entity of dueNotifications) {
      const notification = new Notification(
        entity.channel,
        entity.recipient,
        entity.message,
        {
          type: entity.type,
          title: entity.title,
          metadata: entity.metadata ?? undefined,
        },
      );
      await this.deliverWithRetry(entity, notification);
      processed++;
    }

    if (processed > 0) {
      this.logger.log(`Processed ${processed} scheduled notifications`);
    }

    return processed;
  }

  // ─── Mark read ────────────────────────────────────────────────────────

  async markAsRead(userId: string, notificationIds?: string[]): Promise<number> {
    if (notificationIds && notificationIds.length > 0) {
      const result = await this.notificationRepository.update(
        { id: In(notificationIds), recipient: userId },
        { isRead: true },
      );
      return result.affected ?? 0;
    }
    // Mark all as read
    const result = await this.notificationRepository.update(
      { recipient: userId, isRead: false },
      { isRead: true },
    );
    return result.affected ?? 0;
  }

  // ─── Paginated history ────────────────────────────────────────────────

  async getNotifications(
    userId: string,
    searchDto: SearchNotificationsDto,
  ): Promise<PaginatedResultDto<NotificationEntity>> {
    const query = this.notificationRepository.createQueryBuilder('n');

    query.where('n.recipient = :userId', { userId });

    if (searchDto.channel) {
      query.andWhere('n.channel = :channel', { channel: searchDto.channel });
    }

    if (searchDto.type) {
      query.andWhere('n.type = :type', { type: searchDto.type });
    }

    if (searchDto.deliveryStatus) {
      query.andWhere('n.deliveryStatus = :ds', {
        ds: searchDto.deliveryStatus,
      });
    }

    if (searchDto.startDate) {
      query.andWhere('n.createdAt >= :startDate', {
        startDate: searchDto.startDate,
      });
    }

    if (searchDto.endDate) {
      query.andWhere('n.createdAt <= :endDate', {
        endDate: searchDto.endDate,
      });
    }

    const page = searchDto.page ?? 1;
    const limit = searchDto.limit ?? 20;

    const [data, total] = await query
      .orderBy('n.createdAt', 'DESC')
      .skip(searchDto.skip)
      .take(limit)
      .getManyAndCount();

    return new PaginatedResultDto(data, total, page, limit);
  }

  // ─── Legacy search (backward compat) ─────────────────────────────────

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

  // ─── Preferences ──────────────────────────────────────────────────────

  async getUserPreferences(userId: string): Promise<NotificationPreference[]> {
    return this.preferenceRepository.find({ where: { userId } });
  }

  async updateUserPreference(
    userId: string,
    channel: Channel,
    isEnabled: boolean,
    subscribedTypes?: NotificationType[],
  ): Promise<NotificationPreference> {
    let preference = await this.preferenceRepository.findOne({
      where: { userId, channel },
    });

    if (preference) {
      preference.isEnabled = isEnabled;
      if (subscribedTypes) {
        preference.subscribedTypes = subscribedTypes;
      }
    } else {
      preference = this.preferenceRepository.create({
        userId,
        channel,
        isEnabled,
        subscribedTypes:
          subscribedTypes ?? (Object.values(NotificationType) as NotificationType[]),
      });
    }

    return this.preferenceRepository.save(preference);
  }

  // ─── Templates ────────────────────────────────────────────────────────

  async createTemplate(
    name: string,
    subject: string,
    bodyTemplate: string,
    htmlTemplate?: string,
    channel: Channel = Channel.EMAIL,
  ): Promise<NotificationTemplate> {
    const newTemplate = this.templateRepository.create({
      name,
      subject,
      bodyTemplate,
      htmlTemplate: htmlTemplate ?? null,
      channel,
    });
    return this.templateRepository.save(newTemplate);
  }

  async sendFromTemplate(
    templateName: string,
    channel: Channel,
    recipient: string,
    data: Record<string, any>,
    type: NotificationType = NotificationType.SYSTEM_NOTICE,
  ): Promise<void> {
    const template = await this.templateRepository.findOne({
      where: { name: templateName },
    });
    if (!template) {
      throw new NotFoundException(
        `Template with name "${templateName}" not found`,
      );
    }

    const subject = this.renderTemplate(template.subject, data);
    const message = this.renderTemplate(template.bodyTemplate, data);
    const notification = new Notification(channel, recipient, message, {
      type,
      title: subject,
      metadata: { subject },
      templateName,
      templateData: data,
    });
    await this.send(notification);
  }

  private renderTemplate(template: string, data: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (placeholder, key) => {
      return data[key] !== undefined ? String(data[key]) : placeholder;
    });
  }

  // ─── Unread count ─────────────────────────────────────────────────────

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.count({
      where: { recipient: userId, isRead: false },
    });
  }

  // ─── Emit from other modules ──────────────────────────────────────────

  /**
   * Convenience: create and immediately send a notification.
   */
  async emit(notification: Notification): Promise<NotificationEntity | null> {
    return this.send(notification);
  }
}
