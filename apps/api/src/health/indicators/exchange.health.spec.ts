import { Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';

import { ExchangeHealthIndicator } from './exchange.health';

import { ExchangeManagerService } from '../../exchange/exchange-manager.service';

describe('ExchangeHealthIndicator', () => {
  let indicator: ExchangeHealthIndicator;
  let exchangeManager: { getPublicClient: jest.Mock };
  let mockIndicator: { up: jest.Mock; down: jest.Mock };
  let loggerWarnSpy: jest.SpyInstance;

  const healthyClient = () => ({
    fetchTicker: jest.fn().mockResolvedValue({ last: 50000 })
  });

  beforeEach(async () => {
    exchangeManager = { getPublicClient: jest.fn() };
    mockIndicator = {
      up: jest.fn((data) => ({ exchanges: { status: 'up', ...data } })),
      down: jest.fn((data) => ({ exchanges: { status: 'down', ...data } }))
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeHealthIndicator,
        { provide: ExchangeManagerService, useValue: exchangeManager },
        {
          provide: HealthIndicatorService,
          useValue: { check: jest.fn().mockReturnValue(mockIndicator) }
        }
      ]
    }).compile();

    indicator = module.get<ExchangeHealthIndicator>(ExchangeHealthIndicator);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should report all_healthy when every exchange responds', async () => {
    exchangeManager.getPublicClient.mockResolvedValue(healthyClient());

    const result = await indicator.isHealthy('exchanges');

    expect(mockIndicator.up).toHaveBeenCalledWith(
      expect.objectContaining({
        overallStatus: 'all_healthy',
        healthyCount: 3,
        totalExchanges: 3,
        binance_us: expect.objectContaining({ status: 'healthy', latencyMs: expect.any(Number) }),
        coinbase: expect.objectContaining({ status: 'healthy', latencyMs: expect.any(Number) }),
        kraken: expect.objectContaining({ status: 'healthy', latencyMs: expect.any(Number) })
      })
    );
    expect(mockIndicator.down).not.toHaveBeenCalled();
    expect(result).toEqual({ exchanges: expect.objectContaining({ status: 'up', overallStatus: 'all_healthy' }) });
  });

  it('should report degraded when one exchange fetchTicker rejects', async () => {
    const failingClient = { fetchTicker: jest.fn().mockRejectedValue(new Error('503 Service Unavailable')) };

    exchangeManager.getPublicClient
      .mockResolvedValueOnce(failingClient) // binance_us fails at fetchTicker
      .mockResolvedValueOnce(healthyClient()) // coinbase ok
      .mockResolvedValueOnce(healthyClient()); // kraken ok

    const result = await indicator.isHealthy('exchanges');

    expect(mockIndicator.up).toHaveBeenCalledWith(
      expect.objectContaining({
        overallStatus: 'degraded',
        healthyCount: 2,
        totalExchanges: 3,
        binance_us: expect.objectContaining({ status: 'unhealthy', error: '503 Service Unavailable' })
      })
    );
    expect(mockIndicator.down).not.toHaveBeenCalled();
    expect(result).toEqual({ exchanges: expect.objectContaining({ status: 'up', overallStatus: 'degraded' }) });
  });

  it('should report degraded when one exchange getPublicClient rejects', async () => {
    exchangeManager.getPublicClient
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce(healthyClient())
      .mockResolvedValueOnce(healthyClient());

    const result = await indicator.isHealthy('exchanges');

    expect(mockIndicator.up).toHaveBeenCalledWith(
      expect.objectContaining({
        overallStatus: 'degraded',
        healthyCount: 2,
        totalExchanges: 3
      })
    );
    expect(mockIndicator.down).not.toHaveBeenCalled();
    expect(result).toEqual({ exchanges: expect.objectContaining({ status: 'up', overallStatus: 'degraded' }) });
  });

  it('should report all_unavailable, log warning, and still return up when every exchange is down', async () => {
    exchangeManager.getPublicClient.mockRejectedValue(new Error('Service Unavailable'));

    const result = await indicator.isHealthy('exchanges');

    expect(mockIndicator.up).toHaveBeenCalledWith(
      expect.objectContaining({
        overallStatus: 'all_unavailable',
        healthyCount: 0,
        totalExchanges: 3
      })
    );
    expect(mockIndicator.down).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith('All monitored exchanges are unavailable');
    expect(result).toEqual({ exchanges: expect.objectContaining({ status: 'up', overallStatus: 'all_unavailable' }) });
  });
});
