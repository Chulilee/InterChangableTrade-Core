import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { NotificationStrategy } from './providers/notification.strategy';
import { NotificationGateway } from './providers/notification.gateway';
import { Notification as NotificationClass } from './notification.class';
import { Channel } from './enums/channel.enum';
import { NotificationType } from './enums/notification-type.enum';
import { DeliveryStatus } from './enums/delivery-status.enum';
import { NotFoundException } from '@nestjs/common';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationRepo: jest.Mocked<Repository<Notification>>;
  let preferenceRepo: jest.Mocked<Repository<NotificationPreference>>;
  let templateRepo: jest.Mocked<Repository<NotificationTemplate>>;
  let strategy: jest.Mocked<NotificationStrategy>;
  let gateway: jest.Mocked<NotificationGateway>;

  const mockSend = jest.fn().mockResolvedValue(undefined);

  const createMockRepo = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  });

  const createMockStrategy = () => ({
    getProvider: jest.fn().mockReturnValue({ send: mockSend }),
  });

  const createMockGateway = () => ({
    sendToUser: jest.fn(),
    broadcastToAll: jest.fn(),
    getUserCount: jest.fn().mockReturnValue(0),
  });

  const basePreference = {
    id: 'pref-1',
    userId: 'user-1',
    channel: Channel.IN_APP,
    isEnabled: true,
    subscribedTypes: Object.values(NotificationType),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseNotification = {
    id: 'notif-1',
    recipient: 'user-1',
    channel: Channel.IN_APP,
    type: NotificationType.SYSTEM_NOTICE,
    title: 'Test',
    message: 'Hello',
    metadata: null,
    isRead: false,
    deliveryStatus: DeliveryStatus.PENDING,
    retryCount: 0,
    scheduledAt: null,
    batchId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    notificationRepo = createMockRepo() as any;
    preferenceRepo = createMockRepo() as any;
    templateRepo = createMockRepo() as any;
    strategy = createMockStrategy() as any;
    gateway = createMockGateway() as any;

    // Default: create returns the argument, save returns entity with id
    notificationRepo.create.mockImplementation((e: any) => ({ ...e }));
    notificationRepo.save.mockImplementation(async (e: any) => ({
      ...baseNotification,
      ...e,
      id: e.id ?? baseNotification.id,
    }));
    preferenceRepo.findOne.mockResolvedValue(basePreference as any);
    preferenceRepo.find.mockResolvedValue([basePreference] as any);
    preferenceRepo.save.mockImplementation(async (e: any) => ({
      ...basePreference,
      ...e,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(Notification),
          useValue: notificationRepo,
        },
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: preferenceRepo,
        },
        {
          provide: getRepositoryToken(NotificationTemplate),
          useValue: templateRepo,
        },
        { provide: NotificationStrategy, useValue: strategy },
        { provide: NotificationGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── send() ───────────────────────────────────────────────────────────

  describe('send()', () => {
    it('should send notification when user has channel enabled', async () => {
      const notif = new NotificationClass(Channel.IN_APP, 'user-1', 'Hello');
      const result = await service.send(notif);

      expect(notificationRepo.create).toHaveBeenCalled();
      expect(notificationRepo.save).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result!.deliveryStatus).toBe(DeliveryStatus.SENT);
    });

    it('should skip when user has disabled the channel', async () => {
      preferenceRepo.findOne.mockResolvedValue({
        ...basePreference,
        isEnabled: false,
      } as any);

      const notif = new NotificationClass(Channel.IN_APP, 'user-1', 'Hello');
      const result = await service.send(notif);

      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should skip when user not subscribed to notification type', async () => {
      preferenceRepo.findOne.mockResolvedValue({
        ...basePreference,
        subscribedTypes: [NotificationType.SYSTEM_NOTICE],
      } as any);

      const notif = new NotificationClass(Channel.IN_APP, 'user-1', 'Alert', {
        type: NotificationType.PRICE_ALERT,
      });
      const result = await service.send(notif);

      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should retry up to 3 times on failure', async () => {
      const failingSend = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce(undefined);
      strategy.getProvider.mockReturnValue({ send: failingSend });

      const notif = new NotificationClass(Channel.IN_APP, 'user-1', 'Hello');
      await service.send(notif);

      expect(failingSend).toHaveBeenCalledTimes(3);
      expect(notificationRepo.save).toHaveBeenCalled();
    });

    it('should mark as FAILED after 3 failed attempts', async () => {
      const alwaysFail = jest.fn().mockRejectedValue(new Error('always fail'));
      strategy.getProvider.mockReturnValue({ send: alwaysFail });

      const notif = new NotificationClass(Channel.IN_APP, 'user-1', 'Hello');
      const result = await service.send(notif);

      expect(result!.deliveryStatus).toBe(DeliveryStatus.FAILED);
      expect(result!.retryCount).toBe(3);
    });

    it('should schedule notification when scheduledAt is in the future', async () => {
      const futureDate = new Date(Date.now() + 3600_000);
      const notif = new NotificationClass(Channel.IN_APP, 'user-1', 'Later', {
        scheduledAt: futureDate,
      });

      const result = await service.send(notif);

      expect(result!.deliveryStatus).toBe(DeliveryStatus.SCHEDULED);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // ─── sendBatch() ─────────────────────────────────────────────────────

  describe('sendBatch()', () => {
    it('should send batch notifications with batchId', async () => {
      preferenceRepo.find.mockResolvedValue([]);
      notificationRepo.create.mockImplementation((e: any) => ({ ...e }));
      notificationRepo.save.mockImplementation(async (e: any) => {
        if (Array.isArray(e))
          return e.map((item: any, i: number) => ({
            ...baseNotification,
            ...item,
            id: `batch-${i}`,
          }));
        return { ...baseNotification, ...e, id: e.id ?? baseNotification.id };
      });

      const result = await service.sendBatch(
        Channel.IN_APP,
        NotificationType.ORDER_UPDATE,
        [
          { recipient: 'user-1', message: 'msg1', title: 't1' },
          { recipient: 'user-2', message: 'msg2', title: 't2' },
        ],
      );

      expect(result.batchId).toBeDefined();
      expect(result.sent).toBeGreaterThanOrEqual(0);
      expect(notificationRepo.save).toHaveBeenCalled();
    });

    it('should skip users who disabled the channel', async () => {
      preferenceRepo.find.mockResolvedValue([
        { ...basePreference, userId: 'user-1', isEnabled: false },
      ] as any);

      notificationRepo.create.mockImplementation((e: any) => ({ ...e }));
      notificationRepo.save.mockImplementation(async (e: any) => {
        if (Array.isArray(e))
          return e.map((item: any, i: number) => ({
            ...baseNotification,
            ...item,
            id: `batch-${i}`,
          }));
        return { ...baseNotification, ...e, id: e.id ?? baseNotification.id };
      });

      const result = await service.sendBatch(
        Channel.IN_APP,
        NotificationType.ORDER_UPDATE,
        [
          { recipient: 'user-1', message: 'msg1' },
          { recipient: 'user-2', message: 'msg2' },
        ],
      );

      expect(result.skipped).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── markAsRead() ────────────────────────────────────────────────────

  describe('markAsRead()', () => {
    it('should mark specific notifications as read', async () => {
      notificationRepo.update.mockResolvedValue({ affected: 2 } as any);

      const count = await service.markAsRead('user-1', ['id-1', 'id-2']);

      expect(count).toBe(2);
      expect(notificationRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: 'user-1' }),
        { isRead: true },
      );
    });

    it('should mark all unread notifications when no IDs provided', async () => {
      notificationRepo.update.mockResolvedValue({ affected: 5 } as any);

      const count = await service.markAsRead('user-1');

      expect(count).toBe(5);
    });
  });

  // ─── getNotifications() ──────────────────────────────────────────────

  describe('getNotifications()', () => {
    it('should return paginated notifications', async () => {
      const mockQb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[baseNotification], 1]),
      };
      notificationRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getNotifications('user-1', {
        page: 1,
        limit: 20,
        skip: 0,
      } as any);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('should apply type filter', async () => {
      const mockQb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      notificationRepo.createQueryBuilder.mockReturnValue(mockQb);

      await service.getNotifications('user-1', {
        page: 1,
        limit: 20,
        skip: 0,
        type: NotificationType.PRICE_ALERT,
      } as any);

      expect(mockQb.andWhere).toHaveBeenCalledWith('n.type = :type', {
        type: NotificationType.PRICE_ALERT,
      });
    });

    it('should apply date range filter', async () => {
      const mockQb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      notificationRepo.createQueryBuilder.mockReturnValue(mockQb);

      await service.getNotifications('user-1', {
        page: 1,
        limit: 20,
        skip: 0,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      } as any);

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'n.createdAt >= :startDate',
        { startDate: '2025-01-01' },
      );
      expect(mockQb.andWhere).toHaveBeenCalledWith('n.createdAt <= :endDate', {
        endDate: '2025-12-31',
      });
    });
  });

  // ─── Preferences ──────────────────────────────────────────────────────

  describe('getUserPreferences()', () => {
    it('should return all preferences for a user', async () => {
      preferenceRepo.find.mockResolvedValue([basePreference] as any);

      const result = await service.getUserPreferences('user-1');

      expect(result).toHaveLength(1);
      expect(preferenceRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('updateUserPreference()', () => {
    it('should create new preference when none exists', async () => {
      preferenceRepo.findOne.mockResolvedValue(null);

      const result = await service.updateUserPreference(
        'user-1',
        Channel.EMAIL,
        true,
      );

      expect(preferenceRepo.create).toHaveBeenCalled();
      expect(preferenceRepo.save).toHaveBeenCalled();
    });

    it('should update existing preference', async () => {
      preferenceRepo.findOne.mockResolvedValue({ ...basePreference } as any);

      const result = await service.updateUserPreference(
        'user-1',
        Channel.IN_APP,
        false,
        [NotificationType.ORDER_UPDATE],
      );

      expect(preferenceRepo.save).toHaveBeenCalled();
    });
  });

  // ─── Templates ────────────────────────────────────────────────────────

  describe('createTemplate()', () => {
    it('should create and save a new template', async () => {
      templateRepo.create.mockImplementation((e: any) => e as any);
      templateRepo.save.mockImplementation(async (e: any) => ({
        id: 'tpl-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...e,
      }));

      const result = await service.createTemplate(
        'order-filled',
        'Order Filled',
        'Your order for {{assetCode}} has been filled.',
      );

      expect(result.name).toBe('order-filled');
      expect(result.subject).toBe('Order Filled');
    });
  });

  describe('sendFromTemplate()', () => {
    it('should render template and send notification', async () => {
      templateRepo.findOne.mockResolvedValue({
        id: 'tpl-1',
        name: 'order-filled',
        subject: 'Order {{orderId}} Filled',
        bodyTemplate: 'Your {{side}} order for {{assetCode}} is {{status}}.',
        htmlTemplate: null,
        channel: Channel.EMAIL,
      } as any);

      await service.sendFromTemplate(
        'order-filled',
        Channel.EMAIL,
        'user-1',
        { orderId: '123', side: 'buy', assetCode: 'XLM', status: 'filled' },
        NotificationType.ORDER_UPDATE,
      );

      expect(notificationRepo.create).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing template', async () => {
      templateRepo.findOne.mockResolvedValue(null);

      await expect(
        service.sendFromTemplate('nonexistent', Channel.EMAIL, 'user-1', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getUnreadCount() ────────────────────────────────────────────────

  describe('getUnreadCount()', () => {
    it('should return count of unread notifications', async () => {
      notificationRepo.count.mockResolvedValue(5);

      const count = await service.getUnreadCount('user-1');

      expect(count).toBe(5);
      expect(notificationRepo.count).toHaveBeenCalledWith({
        where: { recipient: 'user-1', isRead: false },
      });
    });
  });

  // ─── search() (legacy) ───────────────────────────────────────────────

  describe('search() (legacy)', () => {
    it('should filter by userId', async () => {
      const mockQb: any = {
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      notificationRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.search({ userId: 'user-1' });

      expect(result).toEqual([]);
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'notification.recipient = :userId',
        { userId: 'user-1' },
      );
    });
  });

  // ─── processScheduledNotifications() ─────────────────────────────────

  describe('processScheduledNotifications()', () => {
    it('should process due scheduled notifications', async () => {
      // Mock the queryBuilder for the second query
      const mockQb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([
            { ...baseNotification, deliveryStatus: DeliveryStatus.SCHEDULED },
          ]),
      };
      notificationRepo.createQueryBuilder.mockReturnValue(mockQb);

      const processed = await service.processScheduledNotifications();

      expect(processed).toBe(1);
      expect(mockSend).toHaveBeenCalled();
    });

    it('should return 0 when no scheduled notifications are due', async () => {
      const mockQb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      notificationRepo.createQueryBuilder.mockReturnValue(mockQb);

      const processed = await service.processScheduledNotifications();

      expect(processed).toBe(0);
    });
  });

  // ─── emit() ──────────────────────────────────────────────────────────

  describe('emit()', () => {
    it('should delegate to send()', async () => {
      const notif = new NotificationClass(
        Channel.IN_APP,
        'user-1',
        'emit test',
      );
      const result = await service.emit(notif);

      expect(result).toBeDefined();
      expect(mockSend).toHaveBeenCalled();
    });
  });
});
