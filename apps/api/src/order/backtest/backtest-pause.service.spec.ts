import { Queue } from 'bullmq';

import { BacktestPauseService } from './backtest-pause.service';

describe('BacktestPauseService', () => {
  let redisMock: {
    set: jest.Mock;
    get: jest.Mock;
    del: jest.Mock;
  };

  const createQueueMock = (clientPromise: Promise<any>): Partial<Queue> => ({
    get client() {
      return clientPromise;
    }
  });

  const createService = async (queueMock: Partial<Queue>) => {
    const service = new BacktestPauseService(queueMock as Queue);
    await service.onModuleInit();
    return service;
  };

  beforeEach(() => {
    redisMock = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn()
    };
  });

  it('sets pause flag with ttl', async () => {
    const queueMock = createQueueMock(Promise.resolve(redisMock));
    const service = await createService(queueMock);

    await service.setPauseFlag('backtest-1');

    expect(redisMock.set).toHaveBeenCalledWith('backtest:pause:backtest-1', 'true', 'EX', 3600);
  });

  it('returns true when pause flag is set', async () => {
    const queueMock = createQueueMock(Promise.resolve(redisMock));
    const service = await createService(queueMock);
    redisMock.get.mockResolvedValue('true');

    const result = await service.isPauseRequested('backtest-1');

    expect(result).toBe(true);
  });

  it('returns false when redis check fails', async () => {
    const queueMock = createQueueMock(Promise.resolve(redisMock));
    const service = await createService(queueMock);
    redisMock.get.mockRejectedValue(new Error('redis down'));

    const result = await service.isPauseRequested('backtest-1');

    expect(result).toBe(false);
  });

  it('returns false when redis is not available', async () => {
    const queueMock = createQueueMock(Promise.reject(new Error('connection failed')));
    const service = await createService(queueMock);

    const result = await service.isPauseRequested('backtest-1');

    expect(result).toBe(false);
  });

  it('clears pause flag and returns success', async () => {
    const queueMock = createQueueMock(Promise.resolve(redisMock));
    const service = await createService(queueMock);

    const result = await service.clearPauseFlag('backtest-1');

    expect(redisMock.del).toHaveBeenCalledWith('backtest:pause:backtest-1');
    expect(result.success).toBe(true);
  });

  it('handles clear gracefully when redis is not available', async () => {
    const queueMock = createQueueMock(Promise.reject(new Error('connection failed')));
    const service = await createService(queueMock);

    // Should not throw, returns failure result
    const result = await service.clearPauseFlag('backtest-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Redis not available');
  });

  it('cleans up reference on module destroy', async () => {
    const queueMock = createQueueMock(Promise.resolve(redisMock));
    const service = await createService(queueMock);

    await service.onModuleDestroy();

    // After destroy, operations should handle null redis gracefully
    const result = await service.isPauseRequested('backtest-1');
    expect(result).toBe(false);
  });

  it('throws when setting pause flag with no redis connection', async () => {
    const queueMock = createQueueMock(Promise.reject(new Error('connection failed')));
    const service = await createService(queueMock);

    await expect(service.setPauseFlag('backtest-1')).rejects.toThrow('Redis connection not available');
  });

  it('isAvailable returns true when redis is connected', async () => {
    const queueMock = createQueueMock(Promise.resolve(redisMock));
    const service = await createService(queueMock);

    expect(service.isAvailable()).toBe(true);
  });

  it('isAvailable returns false when redis is not connected', async () => {
    const queueMock = createQueueMock(Promise.reject(new Error('connection failed')));
    const service = await createService(queueMock);

    expect(service.isAvailable()).toBe(false);
  });

  it('trySetPauseFlag returns success when redis is available', async () => {
    const queueMock = createQueueMock(Promise.resolve(redisMock));
    const service = await createService(queueMock);

    const result = await service.trySetPauseFlag('backtest-1');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('trySetPauseFlag returns failure when redis is not available', async () => {
    const queueMock = createQueueMock(Promise.reject(new Error('connection failed')));
    const service = await createService(queueMock);

    const result = await service.trySetPauseFlag('backtest-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Redis connection not available');
  });
});
