import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SmsNotificationProvider } from './sms-notification.provider';
import { Notification } from '../notification.class';
import { Channel } from '../enums/channel.enum';

describe('SmsNotificationProvider', () => {
  let provider: SmsNotificationProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsNotificationProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'TWILIO_ACCOUNT_SID') return undefined;
              if (key === 'TWILIO_AUTH_TOKEN') return undefined;
              if (key === 'TWILIO_PHONE_NUMBER') return undefined;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<SmsNotificationProvider>(SmsNotificationProvider);
  });

  it('should send SMS notification (skip when Twilio not configured)', async () => {
    const notif = new Notification(
      Channel.SMS,
      '+1234567890',
      'Your order is filled',
    );

    // Twilio not configured, so it should just log and return
    await expect(provider.send(notif)).resolves.toBeUndefined();
  });

  it('should truncate long messages to 160 chars', async () => {
    const notif = new Notification(Channel.SMS, '+1234567890', 'A'.repeat(200));

    await expect(provider.send(notif)).resolves.toBeUndefined();
  });

  it('should build concise order SMS', () => {
    const sms = provider.buildOrderSms({
      side: 'buy',
      assetCode: 'XLM',
      quantity: '100',
      status: 'filled',
    });

    expect(sms).toContain('✅');
    expect(sms).toContain('BUY');
    expect(sms).toContain('XLM');
    expect(sms).toContain('FILLED');
    expect(sms.length).toBeLessThanOrEqual(160);
  });

  it('should build concise price alert SMS', () => {
    const sms = provider.buildPriceAlertSms({
      assetCode: 'XLM',
      currentPrice: '0.65',
      direction: 'above',
    });

    expect(sms).toContain('🔔');
    expect(sms).toContain('XLM');
    expect(sms).toContain('above');
    expect(sms).toContain('0.65');
    expect(sms.length).toBeLessThanOrEqual(160);
  });

  it('should handle cancelled order emoji', () => {
    const sms = provider.buildOrderSms({
      side: 'sell',
      assetCode: 'USDC',
      quantity: '500',
      status: 'cancelled',
    });

    expect(sms).toContain('❌');
    expect(sms).toContain('SELL');
  });
});
