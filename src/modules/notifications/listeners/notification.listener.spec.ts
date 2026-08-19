import { Test, TestingModule } from '@nestjs/testing';
import { NotificationListener } from './notification.listener';
import { NotificationsService } from '../notifications.service';
import { Notification } from '../notification.class';
import {
  OrderUpdateEvent,
  PriceAlertEvent,
  PortfolioAlertEvent,
  SystemNoticeEvent,
} from '../events/notification.events';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';

describe('NotificationListener', () => {
  let listener: NotificationListener;
  let notificationsService: {
    send: jest.Mock;
  };

  beforeEach(async () => {
    notificationsService = { send: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationListener,
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    listener = module.get<NotificationListener>(NotificationListener);
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleOrderUpdate', () => {
    it('should send to all channels for filled order', async () => {
      const event = new OrderUpdateEvent({
        userId: 'user-1',
        orderId: 'ORD-001',
        side: 'buy',
        assetCode: 'XLM',
        quantity: '100',
        price: '0.50',
        status: 'filled',
      });

      await listener.handleOrderUpdate(event);

      expect(notificationsService.send).toHaveBeenCalledTimes(3); // IN_APP, EMAIL, SMS
      const calls = notificationsService.send.mock.calls;
      expect(calls[0][0].type).toBe(NotificationType.ORDER_UPDATE);
      expect(calls[0][0].recipient).toBe('user-1');
    });

    it('should handle partial fill status', async () => {
      const event = new OrderUpdateEvent({
        userId: 'user-1',
        orderId: 'ORD-002',
        side: 'sell',
        assetCode: 'USDC',
        quantity: '50',
        price: '1.00',
        status: 'partial_fill',
      });

      await listener.handleOrderUpdate(event);

      expect(notificationsService.send).toHaveBeenCalledTimes(3);
      const firstCall = notificationsService.send.mock.calls[0][0];
      expect(firstCall.title).toBe('Partial Fill');
    });

    it('should include executedAt in metadata when provided', async () => {
      const execDate = new Date('2025-08-19T10:00:00Z');
      const event = new OrderUpdateEvent({
        userId: 'user-1',
        orderId: 'ORD-003',
        side: 'buy',
        assetCode: 'XLM',
        quantity: '10',
        price: '1.00',
        status: 'filled',
        executedAt: execDate,
      });

      await listener.handleOrderUpdate(event);

      const metadata = notificationsService.send.mock.calls[0][0].metadata;
      expect(metadata.executedAt).toBe(execDate.toISOString());
    });
  });

  describe('handlePriceAlert', () => {
    it('should send to IN_APP and SMS channels', async () => {
      const event = new PriceAlertEvent({
        userId: 'user-2',
        assetCode: 'XLM',
        currentPrice: '0.65',
        thresholdPrice: '0.50',
        direction: 'above',
        changePercent: '30',
      });

      await listener.handlePriceAlert(event);

      expect(notificationsService.send).toHaveBeenCalledTimes(2); // IN_APP, SMS
      const firstCall = notificationsService.send.mock.calls[0][0];
      expect(firstCall.type).toBe(NotificationType.PRICE_ALERT);
      expect(firstCall.metadata.direction).toBe('above');
    });
  });

  describe('handlePortfolioAlert', () => {
    it('should send to IN_APP and EMAIL channels', async () => {
      const event = new PortfolioAlertEvent({
        userId: 'user-3',
        alertType: 'threshold_breach',
        currentValue: '5000',
        threshold: '10000',
        details: { assetBreakdown: 'XLM: 100%' },
      });

      await listener.handlePortfolioAlert(event);

      expect(notificationsService.send).toHaveBeenCalledTimes(2); // IN_APP, EMAIL
      const call = notificationsService.send.mock.calls[0][0];
      expect(call.type).toBe(NotificationType.PORTFOLIO_ALERT);
    });
  });

  describe('handleSystemNotice', () => {
    it('should send targeted notice to specific user', async () => {
      const event = new SystemNoticeEvent({
        title: 'Maintenance',
        message: 'System maintenance at 2 AM',
        severity: 'warning',
        userId: 'user-1',
      });

      await listener.handleSystemNotice(event);

      expect(notificationsService.send).toHaveBeenCalledTimes(2); // IN_APP, EMAIL
    });

    it('should log broadcast for system-wide notice', async () => {
      const event = new SystemNoticeEvent({
        title: 'Outage',
        message: 'Service degraded',
        severity: 'critical',
      });

      await listener.handleSystemNotice(event);

      // No targeted user, so no direct send calls
      expect(notificationsService.send).not.toHaveBeenCalled();
    });
  });
});
