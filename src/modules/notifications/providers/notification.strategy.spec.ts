import { Test, TestingModule } from '@nestjs/testing';
import { NotificationStrategy } from './notification.strategy';
import { WebSocketNotificationProvider } from './websocket-notification.provider';
import { EmailNotificationProvider } from './email-notification.provider';
import { SmsNotificationProvider } from './sms-notification.provider';
import { Channel } from '../enums/channel.enum';

describe('NotificationStrategy', () => {
  let strategy: NotificationStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationStrategy,
        {
          provide: WebSocketNotificationProvider,
          useValue: { send: jest.fn() },
        },
        {
          provide: EmailNotificationProvider,
          useValue: { send: jest.fn() },
        },
        {
          provide: SmsNotificationProvider,
          useValue: { send: jest.fn() },
        },
      ],
    }).compile();

    strategy = module.get<NotificationStrategy>(NotificationStrategy);
  });

  it('should return WebSocket provider for IN_APP channel', () => {
    const provider = strategy.getProvider(Channel.IN_APP);
    expect(provider).toBeDefined();
  });

  it('should return WebSocket provider for WEB_SOCKET channel', () => {
    const provider = strategy.getProvider(Channel.WEB_SOCKET);
    expect(provider).toBeDefined();
  });

  it('should return Email provider for EMAIL channel', () => {
    const provider = strategy.getProvider(Channel.EMAIL);
    expect(provider).toBeDefined();
  });

  it('should return SMS provider for SMS channel', () => {
    const provider = strategy.getProvider(Channel.SMS);
    expect(provider).toBeDefined();
  });

  it('should throw for unknown channel', () => {
    expect(() => strategy.getProvider('unknown' as Channel)).toThrow();
  });
});
