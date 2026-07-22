import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BlockchainEvent } from './entities/blockchain-event.entity';
import { EventQueryService } from './services/event-query.service';

describe('EventQueryService', () => {
  let module: TestingModule;
  let service: EventQueryService;

  const mockEventRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        EventQueryService,
        {
          provide: 'BlockchainEventRepository',
          useValue: mockEventRepo,
        },
      ],
    }).compile();

    await module.init();
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    service = module.get(EventQueryService);
    jest.clearAllMocks();
  });

  const mockQB = () => ({
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getCount: jest.fn(),
  });

  const makeEvent = (
    overrides?: Partial<BlockchainEvent>,
  ): BlockchainEvent => ({
    id: '1',
    uniqueId: 'tx1:0',
    eventType: 'payment',
    transactionHash: 'tx1',
    ledger: 1000,
    timestamp: new Date(),
    sourceAccount: 'sender',
    destinationAccount: 'receiver',
    assetCode: 'USD',
    assetIssuer: 'issuer',
    amount: '100',
    raw: {},
    invalidated: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it('should filter events by transaction hash', async () => {
    const qb = mockQB();
    qb.getMany.mockResolvedValue([makeEvent()]);
    qb.getCount.mockResolvedValue(1);
    mockEventRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findEvents({
      transactionHash: 'tx1',
      skip: 0,
      limit: 20,
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'e.transactionHash = :transactionHash',
      { transactionHash: 'tx1' },
    );
    expect(result.events[0].transactionHash).toBe('tx1');
  });

  it('should filter events by event type', async () => {
    const qb = mockQB();
    qb.getMany.mockResolvedValue([makeEvent({ eventType: 'manage_offer' })]);
    qb.getCount.mockResolvedValue(1);
    mockEventRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findEvents({
      eventType: 'manage_offer' as any,
      skip: 0,
      limit: 20,
    });

    expect(qb.andWhere).toHaveBeenCalledWith('e.eventType = :eventType', {
      eventType: 'manage_offer',
    });
    expect(result.events[0].eventType).toBe('manage_offer');
  });

  it('should filter events by ledger range', async () => {
    const qb = mockQB();
    qb.getMany.mockResolvedValue([makeEvent({ ledger: 1005 })]);
    qb.getCount.mockResolvedValue(1);
    mockEventRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findEvents({
      ledgerFrom: 1001,
      ledgerTo: 2000,
      skip: 0,
      limit: 20,
    });

    expect(qb.andWhere).toHaveBeenCalledWith('e.ledger >= :ledgerFrom', {
      ledgerFrom: 1001,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('e.ledger <= :ledgerTo', {
      ledgerTo: 2000,
    });
    expect(result.events[0].ledger).toBe(1005);
  });

  it('should exclude invalidated events by default', async () => {
    const qb = mockQB();
    qb.getMany.mockResolvedValue([makeEvent()]);
    qb.getCount.mockResolvedValue(1);
    mockEventRepo.createQueryBuilder.mockReturnValue(qb);

    await service.findEvents({ skip: 0, limit: 20 });

    expect(qb.andWhere).toHaveBeenCalledWith('e.invalidated = :invalidated', {
      invalidated: false,
    });
  });

  it('should find events by transaction hash', async () => {
    mockEventRepo.find.mockResolvedValue([makeEvent()]);

    const result = await service.findByTransactionHash('tx1');

    expect(mockEventRepo.find).toHaveBeenCalledWith({
      where: { transactionHash: 'tx1', invalidated: false },
      order: { ledger: 'DESC', createdAt: 'DESC' },
    });
    expect(result).toHaveLength(1);
  });

  it('should find events by idempotency keys', async () => {
    mockEventRepo.find.mockResolvedValue([makeEvent({ uniqueId: 'a' })]);

    const result = await service.findByIdempotencyKeys(['a', 'b']);

    expect(mockEventRepo.find).toHaveBeenCalledWith({
      where: [{ uniqueId: 'a' }, { uniqueId: 'b' }],
    });
    expect(result).toHaveLength(1);
  });

  it('should paginate events correctly', async () => {
    const qb = mockQB();
    qb.getMany.mockResolvedValue([makeEvent()]);
    qb.getCount.mockResolvedValue(1);
    mockEventRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findEvents({ skip: 0, limit: 10 });

    expect(qb.offset).toHaveBeenCalledWith(0);
    expect(qb.limit).toHaveBeenCalledWith(10);
    expect(result.total).toBe(1);
    expect(result.events).toHaveLength(1);
  });
});
