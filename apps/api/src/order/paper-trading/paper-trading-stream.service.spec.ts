import { Logger } from '@nestjs/common';

import { PaperTradingStreamService } from './paper-trading-stream.service';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    xadd: jest.fn(),
    quit: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
    on: jest.fn()
  }));
});

describe('PaperTradingStreamService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes telemetry to redis and gateway with MAXLEN trimming', async () => {
    const gateway = { emit: jest.fn() };
    const redisClient = { xadd: jest.fn() };
    const cacheManager = { store: { client: redisClient } };

    const service = new PaperTradingStreamService(
      { telemetryStream: 'paper-trading:telemetry', telemetryStreamMaxLen: 100000 } as any,
      cacheManager as any,
      gateway as any
    );

    await service.onModuleInit();
    await service.publishLog('session-1', 'info', 'test message', { foo: 'bar' });

    // Verify xadd is called with MAXLEN parameters to prevent unbounded growth
    expect(redisClient.xadd).toHaveBeenCalledWith(
      'paper-trading:telemetry',
      'MAXLEN',
      '~',
      '100000',
      '*',
      'payload',
      expect.any(String)
    );

    // Payload is now the 7th argument (index 6)
    const payload = JSON.parse((redisClient.xadd as jest.Mock).mock.calls[0][6]);
    expect(payload.scope).toBe('log');
    expect(payload.message).toBe('test message');
    expect(payload.timestamp).toBeDefined();

    expect(gateway.emit).toHaveBeenCalledWith(
      'session-1',
      'log',
      expect.objectContaining({
        scope: 'log',
        message: 'test message'
      })
    );
  });

  it('disconnects redis when quit fails', async () => {
    const redisInstance = {
      xadd: jest.fn(),
      quit: jest.fn().mockRejectedValue(new Error('boom')),
      disconnect: jest.fn()
    };
    const cacheManager = { store: {} };

    const service = new PaperTradingStreamService(
      { telemetryStream: 'paper-trading:telemetry' } as any,
      cacheManager as any
    );

    (service as any).redis = redisInstance;

    await service.onModuleDestroy();

    expect(redisInstance.disconnect).toHaveBeenCalled();
  });

  it('still emits telemetry when redis publish fails', async () => {
    const gateway = { emit: jest.fn() };
    const redisClient = { xadd: jest.fn().mockRejectedValue(new Error('redis down')) };
    const cacheManager = { store: { client: redisClient } };

    const service = new PaperTradingStreamService(
      { telemetryStream: 'paper-trading:telemetry' } as any,
      cacheManager as any,
      gateway as any
    );

    await service.onModuleInit();

    await service.publishStatus('session-2', 'active');

    expect(gateway.emit).toHaveBeenCalledWith(
      'session-2',
      'status',
      expect.objectContaining({
        scope: 'status'
      })
    );
  });
});
