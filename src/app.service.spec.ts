import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
  });

  it('reports service info', () => {
    const info = service.getInfo();
    expect(info.status).toBe('ok');
    expect(info.name).toContain('InterChangableTrade');
  });

  it('reports health with a timestamp', () => {
    const health = service.getHealth();
    expect(health.status).toBe('healthy');
    expect(() => new Date(health.timestamp)).not.toThrow();
  });
});
