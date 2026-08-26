import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailNotificationProvider } from './email-notification.provider';
import { Notification } from '../notification.class';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';

describe('EmailNotificationProvider', () => {
  let provider: EmailNotificationProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailNotificationProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test@example.com'),
          },
        },
      ],
    }).compile();

    provider = module.get<EmailNotificationProvider>(EmailNotificationProvider);
  });

  it('should send email notification successfully', async () => {
    const notif = new Notification(
      Channel.EMAIL,
      'user@test.com',
      'Test message',
      {
        type: NotificationType.ORDER_UPDATE,
        title: 'Order Filled',
        metadata: { orderId: '123', subject: 'Order Filled' },
      },
    );

    await expect(provider.send(notif)).resolves.toBeUndefined();
  });

  it('should send email with basic message', async () => {
    const notif = new Notification(
      Channel.EMAIL,
      'user@test.com',
      'Hello world',
    );

    await expect(provider.send(notif)).resolves.toBeUndefined();
  });

  it('should render order email HTML', () => {
    const html = provider.renderOrderEmail({
      orderId: 'ORD-001',
      side: 'buy',
      assetCode: 'XLM',
      quantity: '100',
      price: '0.50',
      status: 'filled',
    });

    expect(html).toContain('Order FILLED');
    expect(html).toContain('ORD-001');
    expect(html).toContain('XLM');
    expect(html).toContain('BUY');
  });
});
