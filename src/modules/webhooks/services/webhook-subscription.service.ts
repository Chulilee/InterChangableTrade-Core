import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WebhookSubscription } from '../entities/webhook-subscription.entity';
import { WebhookStatus } from '../enums/webhook-status.enum';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { CreateWebhookDto } from '../dto/create-webhook.dto';
import { UpdateWebhookDto } from '../dto/update-webhook.dto';

@Injectable()
export class WebhookSubscriptionService {
  private readonly logger = new Logger(WebhookSubscriptionService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,
    private readonly signingService: WebhookSigningService,
    private readonly deliveryService: WebhookDeliveryService,
  ) {}

  /**
   * Register a new webhook subscription.
   */
  async create(
    userId: string,
    dto: CreateWebhookDto,
  ): Promise<WebhookSubscription & { secret: string }> {
    const secret = this.signingService.generateSecret();

    const subscription = this.subscriptionRepo.create({
      userId,
      name: dto.name,
      url: dto.url,
      secret,
      events: dto.events,
      description: dto.description ?? null,
      customHeaders: dto.customHeaders ?? null,
      authToken: dto.authToken ?? null,
      maxRetries: dto.maxRetries ?? 5,
      rateLimitPerMinute: dto.rateLimitPerMinute ?? 60,
      status: WebhookStatus.ACTIVE,
    });

    const saved = await this.subscriptionRepo.save(subscription);

    this.logger.log(
      `Webhook subscription created: ${saved.id} by user ${userId}`,
    );

    return { ...saved, secret };
  }

  /**
   * Get all webhook subscriptions for a user.
   */
  async findAllByUser(
    userId: string,
    options?: {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ data: WebhookSubscription[]; total: number }> {
    const qb = this.subscriptionRepo
      .createQueryBuilder('sub')
      .where('sub.userId = :userId', { userId })
      .orderBy('sub.createdAt', 'DESC');

    if (options?.status) {
      qb.andWhere('sub.status = :status', { status: options.status });
    }
    if (options?.search) {
      qb.andWhere('sub.name ILIKE :search', {
        search: `%${options.search}%`,
      });
    }

    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  /**
   * Get a single webhook subscription by ID.
   */
  async findOne(id: string, userId: string): Promise<WebhookSubscription> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { id, userId },
    });
    if (!subscription) {
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    }
    return subscription;
  }

  /**
   * Update a webhook subscription.
   */
  async update(
    id: string,
    userId: string,
    dto: UpdateWebhookDto,
  ): Promise<WebhookSubscription> {
    const subscription = await this.findOne(id, userId);

    if (dto.name !== undefined) subscription.name = dto.name;
    if (dto.url !== undefined) subscription.url = dto.url;
    if (dto.events !== undefined) subscription.events = dto.events;
    if (dto.description !== undefined)
      subscription.description = dto.description;
    if (dto.status !== undefined) subscription.status = dto.status;
    if (dto.customHeaders !== undefined)
      subscription.customHeaders = dto.customHeaders;
    if (dto.authToken !== undefined) subscription.authToken = dto.authToken;
    if (dto.maxRetries !== undefined) subscription.maxRetries = dto.maxRetries;
    if (dto.rateLimitPerMinute !== undefined) {
      subscription.rateLimitPerMinute = dto.rateLimitPerMinute;
    }

    const saved = await this.subscriptionRepo.save(subscription);

    this.logger.log(`Webhook subscription updated: ${id}`);

    return saved;
  }

  /**
   * Delete a webhook subscription.
   */
  async remove(id: string, userId: string): Promise<void> {
    const subscription = await this.findOne(id, userId);
    await this.subscriptionRepo.remove(subscription);
    this.logger.log(`Webhook subscription deleted: ${id}`);
  }

  /**
   * Pause a webhook subscription.
   */
  async pause(id: string, userId: string): Promise<WebhookSubscription> {
    return this.update(id, userId, { status: WebhookStatus.PAUSED });
  }

  /**
   * Resume a webhook subscription.
   */
  async resume(id: string, userId: string): Promise<WebhookSubscription> {
    return this.update(id, userId, { status: WebhookStatus.ACTIVE });
  }

  /**
   * Send a test webhook delivery.
   */
  async sendTest(id: string, userId: string): Promise<any> {
    const subscription = await this.findOne(id, userId);
    return this.deliveryService.sendTestDelivery(subscription);
  }

  /**
   * Get webhook statistics for a user.
   */
  async getStats(userId: string): Promise<{
    total: number;
    active: number;
    paused: number;
    inactive: number;
    totalDeliveries: number;
    totalFailures: number;
  }> {
    const all = await this.subscriptionRepo.find({ where: { userId } });
    return {
      total: all.length,
      active: all.filter(
        (s: WebhookSubscription) => s.status === WebhookStatus.ACTIVE,
      ).length,
      paused: all.filter(
        (s: WebhookSubscription) => s.status === WebhookStatus.PAUSED,
      ).length,
      inactive: all.filter(
        (s: WebhookSubscription) => s.status === WebhookStatus.INACTIVE,
      ).length,
      totalDeliveries: all.reduce(
        (sum: number, s: WebhookSubscription) => sum + s.totalDeliveries,
        0,
      ),
      totalFailures: all.reduce(
        (sum: number, s: WebhookSubscription) => sum + s.totalFailures,
        0,
      ),
    };
  }

  /**
   * Rotate the signing secret for a webhook.
   */
  async rotateSecret(id: string, userId: string): Promise<{ secret: string }> {
    const subscription = await this.findOne(id, userId);
    const newSecret = this.signingService.generateSecret();
    subscription.secret = newSecret;
    await this.subscriptionRepo.save(subscription);
    this.logger.log(`Webhook secret rotated: ${id}`);
    return { secret: newSecret };
  }
}
