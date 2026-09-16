import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService(
      {
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      } as any,
      {
        ping: jest.fn().mockResolvedValue('PONG'),
      } as any,
    );
  });

  it('reports service info', () => {
    const info = service.getInfo();
    expect(info.status).toBe('ok');
    expect(info.name).toContain('InterChangableTrade');
  });

  it('reports app health with live dependency checks', async () => {
    const health = await service.getHealth();

    expect(health.status).toBe('ok');
    expect(health.database).toEqual({ status: 'up' });
    expect(health.redis).toEqual({ status: 'up' });
    expect(() => new Date(health.timestamp)).not.toThrow();
  });

  it('marks app health as degraded when dependencies fail', async () => {
    const failingService = new AppService(
      {
        query: jest.fn().mockRejectedValue(new Error('db down')),
      } as any,
      {
        ping: jest.fn().mockRejectedValue(new Error('redis down')),
      } as any,
    );

    const health = await failingService.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.database.status).toBe('down');
    expect(health.redis.status).toBe('down');
  });
});
