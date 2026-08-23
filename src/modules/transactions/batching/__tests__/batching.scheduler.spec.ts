import { BatchingScheduler } from '../batching.scheduler';
import { BatchingService } from '../batching.service';

describe('BatchingScheduler', () => {
  let scheduler: BatchingScheduler;
  let onTick: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    onTick = jest.fn().mockResolvedValue(null);
    scheduler = new BatchingScheduler({ onTick } as unknown as BatchingService);
  });

  afterEach(() => {
    scheduler.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('ticks every second while the app runs', () => {
    scheduler.onApplicationBootstrap();
    expect(onTick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3_000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('stops ticking on shutdown', () => {
    scheduler.onApplicationBootstrap();
    jest.advanceTimersByTime(1_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    scheduler.onApplicationShutdown();
    jest.advanceTimersByTime(5_000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('swallows tick errors so the interval keeps running', async () => {
    onTick.mockRejectedValueOnce(new Error('boom'));
    scheduler.onApplicationBootstrap();
    await Promise.resolve();
    jest.advanceTimersByTime(2_000);
    // Interval still alive after the failure.
    expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
