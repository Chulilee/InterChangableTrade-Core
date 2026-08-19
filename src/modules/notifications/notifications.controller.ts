import {
  Controller,
  Post,
  Body,
  Get,
  Put,
  Param,
  Query,
  Patch,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import {
  NotificationEvents,
  OrderUpdateEvent,
  PriceAlertEvent,
  PortfolioAlertEvent,
  SystemNoticeEvent,
} from './events/notification.events';
import { Notification } from './notification.class';
import { Channel } from './enums/channel.enum';
import { NotificationType } from './enums/notification-type.enum';
import { TestNotificationDto } from './dto/test-notification.dto';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto';
import { SendFromTemplateDto } from './dto/send-from-template.dto';
import { SearchNotificationsDto } from './dto/search-notifications.dto';
import { MarkNotificationReadDto } from './dto/mark-notification-read.dto';
import { BatchNotificationDto } from './dto/batch-notification.dto';
import { ScheduleNotificationDto } from './dto/schedule-notification.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Paginated notification history ───────────────────────────────────

  @Get()
  async getNotifications(
    @Query('userId') userId: string,
    @Query() searchDto: SearchNotificationsDto,
  ) {
    return this.notificationsService.getNotifications(userId, searchDto);
  }

  // ─── Unread count ─────────────────────────────────────────────────────

  @Get('unread-count/:userId')
  async getUnreadCount(@Param('userId') userId: string) {
    const count = await this.notificationsService.getUnreadCount(userId);
    return { unreadCount: count };
  }

  // ─── Mark as read ─────────────────────────────────────────────────────

  @Patch('read/:userId')
  async markAsRead(
    @Param('userId') userId: string,
    @Body() dto: MarkNotificationReadDto,
  ) {
    const count = await this.notificationsService.markAsRead(
      userId,
      dto.notificationIds,
    );
    return { markedCount: count };
  }

  // ─── Preferences ──────────────────────────────────────────────────────

  @Get('preferences/:userId')
  async getPreferences(@Param('userId') userId: string) {
    return this.notificationsService.getUserPreferences(userId);
  }

  @Put('preferences/:userId')
  async updatePreference(
    @Param('userId') userId: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notificationsService.updateUserPreference(
      userId,
      dto.channel,
      dto.isEnabled,
      dto.subscribedTypes,
    );
  }

  // ─── Templates ────────────────────────────────────────────────────────

  @Post('templates')
  async createTemplate(@Body() dto: CreateNotificationTemplateDto) {
    return this.notificationsService.createTemplate(
      dto.name,
      dto.subject,
      dto.bodyTemplate,
      dto.htmlTemplate,
      dto.channel,
    );
  }

  @Post('send-from-template')
  async sendFromTemplate(@Body() dto: SendFromTemplateDto) {
    await this.notificationsService.sendFromTemplate(
      dto.templateName,
      dto.channel,
      dto.recipient,
      dto.data,
      dto.type,
    );
    return { message: 'Notification sent from template' };
  }

  // ─── Batch delivery ───────────────────────────────────────────────────

  @Post('batch')
  async sendBatch(@Body() dto: BatchNotificationDto) {
    return this.notificationsService.sendBatch(
      dto.channel,
      dto.type ?? NotificationType.SYSTEM_NOTICE,
      dto.notifications,
    );
  }

  // ─── Schedule delivery ────────────────────────────────────────────────

  @Post('schedule')
  async scheduleNotification(@Body() dto: ScheduleNotificationDto) {
    const notification = new Notification(
      dto.channel,
      dto.recipient,
      dto.message,
      {
        type: dto.type,
        title: dto.title,
        metadata: dto.metadata,
        scheduledAt: new Date(dto.scheduledAt),
      },
    );
    return this.notificationsService.send(notification);
  }

  // ─── Direct send ──────────────────────────────────────────────────────

  @Post('send')
  async sendNotification(@Body() dto: CreateNotificationDto) {
    const notification = new Notification(
      dto.channel,
      dto.recipient,
      dto.message,
      {
        type: dto.type,
        title: dto.title,
        metadata: dto.metadata,
      },
    );
    return this.notificationsService.send(notification);
  }

  // ─── Legacy endpoints (backward compat) ───────────────────────────────

  @Get('history')
  async searchHistory(@Query() searchDto: SearchNotificationsDto) {
    const userId = searchDto.userId ?? 'anonymous';
    return this.notificationsService.getNotifications(userId, searchDto);
  }

  @Post('test')
  async testNotification(@Body() dto: TestNotificationDto) {
    const notification = new Notification(
      Channel.IN_APP,
      'test-user',
      dto.message,
      {
        type: dto.type ?? NotificationType.SYSTEM_NOTICE,
        title: dto.title ?? 'Test Notification',
      },
    );
    this.eventEmitter.emit(NotificationEvents.SEND_NOTIFICATION, notification);
    return { message: 'Notification sent!' };
  }

  // ─── Trigger events (for other modules / testing) ─────────────────────

  @Post('trigger/order')
  async triggerOrderUpdate(@Body() body: {
    userId: string;
    orderId: string;
    side: 'buy' | 'sell';
    assetCode: string;
    quantity: string;
    price: string;
    status: 'filled' | 'partial_fill' | 'cancelled' | 'rejected' | 'placed';
    executedAt?: string;
  }) {
    this.eventEmitter.emit(
      OrderUpdateEvent.NAME,
      new OrderUpdateEvent({
        ...body,
        executedAt: body.executedAt ? new Date(body.executedAt) : undefined,
      }),
    );
    return { message: 'Order update event triggered' };
  }

  @Post('trigger/price')
  async triggerPriceAlert(@Body() body: {
    userId: string;
    assetCode: string;
    currentPrice: string;
    thresholdPrice: string;
    direction: 'above' | 'below';
    changePercent: string;
  }) {
    this.eventEmitter.emit(
      PriceAlertEvent.NAME,
      new PriceAlertEvent(body),
    );
    return { message: 'Price alert event triggered' };
  }

  @Post('trigger/portfolio')
  async triggerPortfolioAlert(@Body() body: {
    userId: string;
    alertType: string;
    currentValue: string;
    threshold: string;
    details: Record<string, any>;
  }) {
    this.eventEmitter.emit(
      PortfolioAlertEvent.NAME,
      new PortfolioAlertEvent(body as any),
    );
    return { message: 'Portfolio alert event triggered' };
  }

  @Post('trigger/system')
  async triggerSystemNotice(@Body() body: {
    title: string;
    message: string;
    severity: 'info' | 'warning' | 'critical';
    userId?: string;
    metadata?: Record<string, any>;
  }) {
    this.eventEmitter.emit(
      SystemNoticeEvent.NAME,
      new SystemNoticeEvent(body),
    );
    return { message: 'System notice event triggered' };
  }
}
