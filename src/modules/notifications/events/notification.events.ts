import { NotificationType } from '../enums/notification-type.enum';

/** Core notification events */
export class NotificationEvents {
  static readonly SEND_NOTIFICATION = 'notification.send';
  static readonly SEND_BATCH = 'notification.batch';
  static readonly SCHEDULE_NOTIFICATION = 'notification.schedule';
}

/** Trading-specific trigger events */
export class OrderUpdateEvent {
  static readonly NAME = 'notification.trigger.order_update';
  constructor(
    public readonly payload: {
      userId: string;
      orderId: string;
      side: 'buy' | 'sell';
      assetCode: string;
      quantity: string;
      price: string;
      status: 'filled' | 'partial_fill' | 'cancelled' | 'rejected' | 'placed';
      executedAt?: Date;
    },
  ) {}
}

export class PriceAlertEvent {
  static readonly NAME = 'notification.trigger.price_alert';
  constructor(
    public readonly payload: {
      userId: string;
      assetCode: string;
      currentPrice: string;
      thresholdPrice: string;
      direction: 'above' | 'below';
      changePercent: string;
    },
  ) {}
}

export class PortfolioAlertEvent {
  static readonly NAME = 'notification.trigger.portfolio_alert';
  constructor(
    public readonly payload: {
      userId: string;
      alertType:
        'threshold_breach' | 'margin_warning' | 'large_move' | 'new_asset';
      currentValue: string;
      threshold: string;
      details: Record<string, any>;
    },
  ) {}
}

export class SystemNoticeEvent {
  static readonly NAME = 'notification.trigger.system_notice';
  constructor(
    public readonly payload: {
      title: string;
      message: string;
      severity: 'info' | 'warning' | 'critical';
      userId?: string; // Optional: null means broadcast to all users
      metadata?: Record<string, any>;
    },
  ) {}
}
