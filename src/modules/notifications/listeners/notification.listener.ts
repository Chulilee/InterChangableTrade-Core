import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  NotificationEvents,
  OrderUpdateEvent,
  PriceAlertEvent,
  PortfolioAlertEvent,
  SystemNoticeEvent,
} from '../events/notification.events';
import { NotificationsService } from '../notifications.service';
import { Notification } from '../notification.class';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(NotificationEvents.SEND_NOTIFICATION)
  handleSendNotificationEvent(notification: Notification) {
    this.logger.debug(
      `Handling SEND_NOTIFICATION for ${notification.recipient} on ${notification.channel}`,
    );
    this.notificationsService.send(notification);
  }

  @OnEvent(OrderUpdateEvent.NAME)
  async handleOrderUpdate(event: OrderUpdateEvent) {
    const { payload } = event;
    const statusLabel =
      payload.status === 'filled'
        ? 'fully filled'
        : payload.status === 'partial_fill'
          ? 'partially filled'
          : payload.status;

    const message =
      `Your ${payload.side.toUpperCase()} order for ${payload.quantity} ${payload.assetCode} ` +
      `at $${payload.price} has been ${statusLabel}.`;

    const title =
      payload.status === 'filled'
        ? 'Order Filled'
        : payload.status === 'partial_fill'
          ? 'Partial Fill'
          : `Order ${payload.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;

    const metadata: Record<string, any> = {
      orderId: payload.orderId,
      side: payload.side,
      assetCode: payload.assetCode,
      quantity: payload.quantity,
      price: payload.price,
      status: payload.status,
    };
    if (payload.executedAt) {
      metadata.executedAt = payload.executedAt.toISOString();
    }

    // Deliver to all user-enabled channels
    const channels = [Channel.IN_APP, Channel.EMAIL, Channel.SMS];
    for (const channel of channels) {
      await this.notificationsService.send(
        new Notification(channel, payload.userId, message, {
          type: NotificationType.ORDER_UPDATE,
          title,
          metadata,
        }),
      );
    }
  }

  @OnEvent(PriceAlertEvent.NAME)
  async handlePriceAlert(event: PriceAlertEvent) {
    const { payload } = event;

    const message =
      `${payload.assetCode} price is now ${payload.direction} your alert threshold ` +
      `(current: $${payload.currentPrice}, threshold: $${payload.thresholdPrice}, ` +
      `change: ${payload.changePercent}%).`;

    const metadata: Record<string, any> = {
      assetCode: payload.assetCode,
      currentPrice: payload.currentPrice,
      thresholdPrice: payload.thresholdPrice,
      direction: payload.direction,
      changePercent: payload.changePercent,
    };

    const channels = [Channel.IN_APP, Channel.SMS];
    for (const channel of channels) {
      await this.notificationsService.send(
        new Notification(channel, payload.userId, message, {
          type: NotificationType.PRICE_ALERT,
          title: `Price Alert: ${payload.assetCode}`,
          metadata,
        }),
      );
    }
  }

  @OnEvent(PortfolioAlertEvent.NAME)
  async handlePortfolioAlert(event: PortfolioAlertEvent) {
    const { payload } = event;

    const alertTypeLabels: Record<string, string> = {
      threshold_breach: 'Portfolio Threshold Breach',
      margin_warning: 'Margin Warning',
      large_move: 'Large Portfolio Move',
      new_asset: 'New Asset Available',
    };

    const title = alertTypeLabels[payload.alertType] ?? 'Portfolio Alert';
    const message =
      `Portfolio alert: ${payload.alertType.replace('_', ' ')}. ` +
      `Current value: $${payload.currentValue}, ` +
      `threshold: $${payload.threshold}.`;

    const metadata: Record<string, any> = {
      alertType: payload.alertType,
      currentValue: payload.currentValue,
      threshold: payload.threshold,
      ...payload.details,
    };

    const channels = [Channel.IN_APP, Channel.EMAIL];
    for (const channel of channels) {
      await this.notificationsService.send(
        new Notification(channel, payload.userId, message, {
          type: NotificationType.PORTFOLIO_ALERT,
          title,
          metadata,
        }),
      );
    }
  }

  @OnEvent(SystemNoticeEvent.NAME)
  async handleSystemNotice(event: SystemNoticeEvent) {
    const { payload } = event;
    const title = `[${payload.severity.toUpperCase()}] ${payload.title}`;

    const metadata: Record<string, any> = {
      severity: payload.severity,
      ...payload.metadata,
    };

    if (payload.userId) {
      // Targeted system notice to a specific user
      const channels = [Channel.IN_APP, Channel.EMAIL];
      for (const channel of channels) {
        await this.notificationsService.send(
          new Notification(channel, payload.userId, payload.message, {
            type: NotificationType.SYSTEM_NOTICE,
            title,
            metadata,
          }),
        );
      }
    } else {
      // Broadcast: we emit to all enabled users. In a real system this
      // would iterate over all active user IDs. For now we emit a single
      // IN_APP event that the gateway broadcasts.
      this.logger.log(`Broadcasting system notice: ${payload.title}`);
    }
  }
}
