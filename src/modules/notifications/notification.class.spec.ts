import { Notification } from './notification.class';
import { Channel } from './enums/channel.enum';
import { NotificationType } from './enums/notification-type.enum';
import { DeliveryStatus } from './enums/delivery-status.enum';

describe('Notification class', () => {
  it('should create with required fields and defaults', () => {
    const notif = new Notification(Channel.IN_APP, 'user-1', 'Hello');

    expect(notif.channel).toBe(Channel.IN_APP);
    expect(notif.recipient).toBe('user-1');
    expect(notif.message).toBe('Hello');
    expect(notif.type).toBe(NotificationType.SYSTEM_NOTICE);
    expect(notif.deliveryStatus).toBe(DeliveryStatus.PENDING);
    expect(notif.title).toBeUndefined();
    expect(notif.metadata).toBeUndefined();
  });

  it('should accept optional fields', () => {
    const metadata = { orderId: '123' };
    const scheduledAt = new Date('2025-12-01');
    const notif = new Notification(Channel.EMAIL, 'user-2', 'Order filled', {
      type: NotificationType.ORDER_UPDATE,
      title: 'Order Filled',
      metadata,
      templateName: 'order-filled',
      templateData: { orderId: '123' },
      scheduledAt,
      batchId: 'batch-1',
    });

    expect(notif.type).toBe(NotificationType.ORDER_UPDATE);
    expect(notif.title).toBe('Order Filled');
    expect(notif.metadata).toEqual(metadata);
    expect(notif.templateName).toBe('order-filled');
    expect(notif.scheduledAt).toBe(scheduledAt);
    expect(notif.batchId).toBe('batch-1');
  });
});
