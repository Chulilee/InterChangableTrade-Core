import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookSubscription } from '../entities/webhook-subscription.entity';
import { WebhookStatus } from '../enums/webhook-status.enum';
import { WebhookEvent } from '../enums/webhook-event.enum';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  })),
});

describe('WebhookSubscriptionService', () => {
  let service: WebhookSubscriptionService;
  let subscriptionRepo: ReturnType<typeof mockRepo>;
  let deliveryService: jest.Mocked<WebhookDeliveryService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookSubscriptionService,
        {
          provide: getRepositoryToken(WebhookSubscription),
          useFactory: mockRepo,
        },
        {
          provide: WebhookSigningService,
          useValue: {
            generateSecret: jest
              .fn()
              .mockReturnValue('mock-secret-12345678901234567890123456789012'),
          },
        },
        {
          provide: WebhookDeliveryService,
          useValue: {
            sendTestDelivery: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookSubscriptionService>(
      WebhookSubscriptionService,
    );
    subscriptionRepo = module.get(getRepositoryToken(WebhookSubscription));
    deliveryService = module.get(WebhookDeliveryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a webhook subscription with generated secret', async () => {
      const dto = {
        name: 'My Webhook',
        url: 'https://example.com/webhook',
        events: [WebhookEvent.TRADE_COMPLETED],
      };

      subscriptionRepo.create.mockReturnValue({
        id: 'test-id',
        userId: 'user-id',
        ...dto,
        secret: 'mock-secret-12345678901234567890123456789012',
      });
      subscriptionRepo.save.mockResolvedValue({
        id: 'test-id',
        userId: 'user-id',
        ...dto,
        secret: 'mock-secret-12345678901234567890123456789012',
      });

      const result = await service.create('user-id', dto);

      expect(result.id).toBe('test-id');
      expect(result.secret).toBe(
        'mock-secret-12345678901234567890123456789012',
      );
      expect(subscriptionRepo.create).toHaveBeenCalled();
      expect(subscriptionRepo.save).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a webhook if found', async () => {
      const mockWebhook = {
        id: 'test-id',
        userId: 'user-id',
        name: 'My Webhook',
      };
      subscriptionRepo.findOne.mockResolvedValue(mockWebhook);

      const result = await service.findOne('test-id', 'user-id');
      expect(result).toEqual(mockWebhook);
    });

    it('should throw NotFoundException if not found', async () => {
      subscriptionRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', 'user-id')).rejects.toThrow(
        'Webhook subscription nonexistent not found',
      );
    });
  });

  describe('remove', () => {
    it('should remove a webhook subscription', async () => {
      const mockWebhook = { id: 'test-id', userId: 'user-id' };
      subscriptionRepo.findOne.mockResolvedValue(mockWebhook);
      subscriptionRepo.remove.mockResolvedValue(mockWebhook as any);

      await service.remove('test-id', 'user-id');

      expect(subscriptionRepo.remove).toHaveBeenCalledWith(mockWebhook);
    });
  });

  describe('sendTest', () => {
    it('should send a test delivery', async () => {
      const mockWebhook = {
        id: 'test-id',
        userId: 'user-id',
        name: 'Test Webhook',
      };
      subscriptionRepo.findOne.mockResolvedValue(mockWebhook);
      deliveryService.sendTestDelivery.mockResolvedValue({
        id: 'delivery-1',
      } as any);

      const result = await service.sendTest('test-id', 'user-id');

      expect(deliveryService.sendTestDelivery).toHaveBeenCalledWith(
        mockWebhook,
      );
      expect(result).toEqual({ id: 'delivery-1' });
    });
  });

  describe('getStats', () => {
    it('should return aggregated stats', async () => {
      subscriptionRepo.find.mockResolvedValue([
        { status: WebhookStatus.ACTIVE, totalDeliveries: 10, totalFailures: 1 },
        { status: WebhookStatus.ACTIVE, totalDeliveries: 5, totalFailures: 0 },
        { status: WebhookStatus.PAUSED, totalDeliveries: 2, totalFailures: 2 },
      ]);

      const stats = await service.getStats('user-id');

      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.paused).toBe(1);
      expect(stats.inactive).toBe(0);
      expect(stats.totalDeliveries).toBe(17);
      expect(stats.totalFailures).toBe(3);
    });
  });

  describe('rotateSecret', () => {
    it('should rotate the signing secret', async () => {
      const mockWebhook = {
        id: 'test-id',
        userId: 'user-id',
        secret: 'old-secret',
      };
      subscriptionRepo.findOne.mockResolvedValue(mockWebhook);
      subscriptionRepo.save.mockResolvedValue({
        ...mockWebhook,
        secret: 'new-secret',
      });

      const result = await service.rotateSecret('test-id', 'user-id');

      expect(result.secret).toBe(
        'mock-secret-12345678901234567890123456789012',
      );
      expect(subscriptionRepo.save).toHaveBeenCalled();
    });
  });
});
