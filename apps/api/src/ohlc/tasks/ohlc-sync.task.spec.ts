import { Job } from 'bullmq';

import { OHLCSyncTask } from './ohlc-sync.task';

import { CoinService } from '../../coin/coin.service';
import { ExchangeSymbolMap } from '../exchange-symbol-map.entity';
import { OHLCService } from '../ohlc.service';
import { ExchangeOHLCService } from '../services/exchange-ohlc.service';

describe('OHLCSyncTask', () => {
  let task: OHLCSyncTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let ohlcService: jest.Mocked<OHLCService>;
  let exchangeOHLC: jest.Mocked<ExchangeOHLCService>;
  let coinService: jest.Mocked<CoinService>;
  let configService: { get: jest.Mock };

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };

    queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue(undefined)
    };

    ohlcService = {
      getActiveSymbolMaps: jest.fn(),
      upsertCandles: jest.fn(),
      incrementFailureCount: jest.fn(),
      markSyncSuccess: jest.fn()
    } as unknown as jest.Mocked<OHLCService>;

    exchangeOHLC = {
      fetchOHLC: jest.fn()
    } as unknown as jest.Mocked<ExchangeOHLCService>;

    coinService = {
      updateCurrentPrice: jest.fn()
    } as unknown as jest.Mocked<CoinService>;

    configService = { get: jest.fn() };

    task = new OHLCSyncTask(queue as any, ohlcService, exchangeOHLC, coinService, configService as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('onModuleInit skips scheduling in development', async () => {
    process.env.NODE_ENV = 'development';
    const scheduleSpy = jest.spyOn(task as any, 'scheduleOHLCSyncJob').mockResolvedValue(undefined);

    await task.onModuleInit();

    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it('onModuleInit schedules job when enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DISABLE_BACKGROUND_TASKS = 'false';
    configService.get.mockReturnValue(undefined);
    const scheduleSpy = jest.spyOn(task as any, 'scheduleOHLCSyncJob').mockResolvedValue(undefined);

    await task.onModuleInit();

    expect(scheduleSpy).toHaveBeenCalled();
  });

  it('handleOHLCSync returns empty summary when no mappings', async () => {
    ohlcService.getActiveSymbolMaps.mockResolvedValue([]);

    const job = { updateProgress: jest.fn(), name: 'ohlc-sync', id: 'job-1' } as unknown as Job;
    const result = await task.handleOHLCSync(job);

    expect(result).toEqual({
      totalMappings: 0,
      processed: 0,
      successCount: 0,
      errorCount: 0
    });
  });

  it('handleOHLCSync updates current price on success', async () => {
    const mapping = {
      id: 'map-1',
      coinId: 'btc',
      exchangeId: 'ex-1',
      symbol: 'BTC/USD',
      priority: 0,
      exchange: { slug: 'binance_us' }
    } as ExchangeSymbolMap;

    ohlcService.getActiveSymbolMaps.mockResolvedValue([mapping]);
    jest.spyOn(task as any, 'syncSingleMapping').mockResolvedValue({ success: true, closePrice: 123 });
    jest.spyOn(task as any, 'sleep').mockResolvedValue(undefined);

    const job = { updateProgress: jest.fn(), name: 'ohlc-sync', id: 'job-1' } as unknown as Job;
    const result = await task.handleOHLCSync(job);

    expect(coinService.updateCurrentPrice).toHaveBeenCalledWith('btc', 123);
    expect(result.successCount).toBe(1);
  });

  it('process throws for unknown job names', async () => {
    const job = { name: 'other', id: 'job-1' } as Job;

    await expect(task.process(job)).rejects.toThrow('Unknown job name');
  });
});
