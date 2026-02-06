import { Job } from 'bullmq';

import { OHLCSyncTask } from './ohlc-sync.task';

import { CoinService } from '../../coin/coin.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { ExchangeSymbolMap } from '../exchange-symbol-map.entity';
import { OHLCService } from '../ohlc.service';
import { ExchangeOHLCService } from '../services/exchange-ohlc.service';

describe('OHLCSyncTask', () => {
  let task: OHLCSyncTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let ohlcService: jest.Mocked<OHLCService>;
  let exchangeOHLC: jest.Mocked<ExchangeOHLCService>;
  let coinService: jest.Mocked<CoinService>;
  let exchangeService: jest.Mocked<ExchangeService>;
  let configService: { get: jest.Mock };
  let lockService: { acquire: jest.Mock; release: jest.Mock };

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
      markSyncSuccess: jest.fn(),
      deactivateFailedMappings: jest.fn().mockResolvedValue(0),
      updateSymbolMapStatus: jest.fn()
    } as unknown as jest.Mocked<OHLCService>;

    exchangeOHLC = {
      fetchOHLC: jest.fn(),
      getExchangePriority: jest.fn().mockReturnValue(['binance_us', 'gdax', 'kraken']),
      getAvailableSymbols: jest.fn().mockResolvedValue([])
    } as unknown as jest.Mocked<ExchangeOHLCService>;

    coinService = {
      updateCurrentPrice: jest.fn(),
      getPopularCoins: jest.fn().mockResolvedValue([])
    } as unknown as jest.Mocked<CoinService>;

    exchangeService = {
      getExchanges: jest.fn().mockResolvedValue([])
    } as unknown as jest.Mocked<ExchangeService>;

    configService = { get: jest.fn() };

    lockService = {
      acquire: jest.fn().mockResolvedValue({ acquired: true, lockId: 'test-lock' }),
      release: jest.fn().mockResolvedValue(undefined)
    };

    task = new OHLCSyncTask(
      queue as any,
      ohlcService,
      exchangeOHLC,
      coinService,
      exchangeService,
      configService as any,
      lockService as any
    );
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
    ohlcService.getActiveSymbolMaps.mockResolvedValue([]);
    const scheduleSpy = jest.spyOn(task as any, 'scheduleOHLCSyncJob').mockResolvedValue(undefined);

    await task.onModuleInit();

    expect(scheduleSpy).toHaveBeenCalled();
  });

  it('onModuleInit seeds symbol maps when table is empty', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DISABLE_BACKGROUND_TASKS = 'false';
    configService.get.mockReturnValue(undefined);
    ohlcService.getActiveSymbolMaps.mockResolvedValue([]);
    exchangeService.getExchanges.mockResolvedValue([{ id: 'ex-1', slug: 'binance_us', name: 'Binance US' }] as any);
    coinService.getPopularCoins.mockResolvedValue([{ id: 'btc', symbol: 'btc' }] as any);
    ohlcService.upsertSymbolMap = jest.fn().mockResolvedValue({});
    // getAvailableSymbols returns a valid pair for BTC on binance_us
    exchangeOHLC.getAvailableSymbols.mockResolvedValue(['BTC/USD']);
    jest.spyOn(task as any, 'scheduleOHLCSyncJob').mockResolvedValue(undefined);

    await task.onModuleInit();

    expect(ohlcService.deactivateFailedMappings).toHaveBeenCalledWith(24);
    expect(ohlcService.upsertSymbolMap).toHaveBeenCalledWith({
      coinId: 'btc',
      exchangeId: 'ex-1',
      symbol: 'BTC/USD',
      isActive: true,
      priority: 0,
      failureCount: 0
    });
  });

  it('onModuleInit skips seeding when mappings already exist', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DISABLE_BACKGROUND_TASKS = 'false';
    configService.get.mockReturnValue(undefined);
    ohlcService.getActiveSymbolMaps.mockResolvedValue([{ id: 'existing' }] as any);
    jest.spyOn(task as any, 'scheduleOHLCSyncJob').mockResolvedValue(undefined);

    await task.onModuleInit();

    expect(exchangeService.getExchanges).not.toHaveBeenCalled();
  });

  it('refreshSymbolMaps skips when lock not acquired', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DISABLE_BACKGROUND_TASKS = 'false';
    configService.get.mockReturnValue(undefined);
    lockService.acquire.mockResolvedValue({ acquired: false });

    await task.refreshSymbolMaps();

    expect(exchangeService.getExchanges).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('refreshSymbolMaps acquires and releases lock', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DISABLE_BACKGROUND_TASKS = 'false';
    configService.get.mockReturnValue(undefined);
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'refresh-lock' });
    exchangeService.getExchanges.mockResolvedValue([]);

    await task.refreshSymbolMaps();

    expect(lockService.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'ohlc-sync:symbol-map-refresh-lock' })
    );
    expect(lockService.release).toHaveBeenCalledWith('ohlc-sync:symbol-map-refresh-lock', 'refresh-lock');
  });

  it('scheduleOHLCSyncJob skips when lock not acquired', async () => {
    lockService.acquire.mockResolvedValue({ acquired: false });

    await (task as any).scheduleOHLCSyncJob();

    expect(queue.getRepeatableJobs).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('scheduleOHLCSyncJob skips when job already scheduled', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'schedule-lock' });
    queue.getRepeatableJobs.mockResolvedValue([{ name: 'ohlc-sync', pattern: '0 * * * *' }]);

    await (task as any).scheduleOHLCSyncJob();

    expect(queue.add).not.toHaveBeenCalled();
    expect(lockService.release).toHaveBeenCalledWith('ohlc-sync:schedule-lock', 'schedule-lock');
  });

  it('scheduleOHLCSyncJob schedules with configured cron pattern', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'schedule-lock' });
    queue.getRepeatableJobs.mockResolvedValue([]);
    configService.get.mockReturnValue('*/15 * * * *');

    await (task as any).scheduleOHLCSyncJob();

    expect(queue.add).toHaveBeenCalledWith(
      'ohlc-sync',
      expect.objectContaining({ description: 'Scheduled OHLC sync job' }),
      expect.objectContaining({
        repeat: { pattern: '*/15 * * * *' },
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50
      })
    );
    expect(lockService.release).toHaveBeenCalledWith('ohlc-sync:schedule-lock', 'schedule-lock');
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

  it('handleOHLCSync tries mappings in priority order until one succeeds', async () => {
    const mappingHighPriority = {
      id: 'map-1',
      coinId: 'btc',
      exchangeId: 'ex-1',
      symbol: 'BTC/USD',
      priority: 0,
      failureCount: 0,
      exchange: { slug: 'binance_us' }
    } as ExchangeSymbolMap;

    const mappingLowPriority = {
      id: 'map-2',
      coinId: 'btc',
      exchangeId: 'ex-2',
      symbol: 'BTC/USDT',
      priority: 1,
      failureCount: 0,
      exchange: { slug: 'gdax' }
    } as ExchangeSymbolMap;

    ohlcService.getActiveSymbolMaps.mockResolvedValue([mappingLowPriority, mappingHighPriority]);
    exchangeOHLC.fetchOHLC.mockImplementation(async (slug, symbol) => {
      if (symbol === 'BTC/USD') {
        return {
          success: false,
          candles: []
        };
      }
      return {
        success: true,
        candles: [
          {
            timestamp: 1700000000000,
            open: 100,
            high: 110,
            low: 90,
            close: 105,
            volume: 1
          }
        ]
      };
    });
    jest.spyOn(task as any, 'sleep').mockResolvedValue(undefined);

    const job = { updateProgress: jest.fn(), name: 'ohlc-sync', id: 'job-1' } as unknown as Job;
    const result = await task.handleOHLCSync(job);

    expect(exchangeOHLC.fetchOHLC.mock.calls[0][1]).toBe('BTC/USD');
    expect(exchangeOHLC.fetchOHLC.mock.calls[1][1]).toBe('BTC/USDT');
    expect(coinService.updateCurrentPrice).toHaveBeenCalledWith('btc', 105);
    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  it('syncSingleMapping upserts candles and marks sync success', async () => {
    const mapping = {
      id: 'map-4',
      coinId: 'btc',
      exchangeId: 'ex-1',
      symbol: 'BTC/USD',
      priority: 0,
      failureCount: 0,
      exchange: { slug: 'binance_us' }
    } as ExchangeSymbolMap;

    exchangeOHLC.fetchOHLC.mockResolvedValue({
      success: true,
      candles: [
        {
          timestamp: 1700000000000,
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 1
        },
        {
          timestamp: 1700003600000,
          open: 105,
          high: 115,
          low: 95,
          close: 110,
          volume: 2
        }
      ]
    });

    const result = await (task as any).syncSingleMapping(mapping, 0);

    expect(ohlcService.upsertCandles).toHaveBeenCalledWith([
      expect.objectContaining({
        coinId: 'btc',
        exchangeId: 'ex-1',
        timestamp: new Date(1700000000000),
        close: 105
      }),
      expect.objectContaining({
        coinId: 'btc',
        exchangeId: 'ex-1',
        timestamp: new Date(1700003600000),
        close: 110
      })
    ]);
    expect(ohlcService.markSyncSuccess).toHaveBeenCalledWith('map-4');
    expect(ohlcService.incrementFailureCount).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, closePrice: 110 });
  });

  it('deactivates mapping after MAX_CONSECUTIVE_FAILURES sync failures', async () => {
    const mapping = {
      id: 'map-1',
      coinId: 'btc',
      exchangeId: 'ex-1',
      symbol: 'BTC/USD',
      priority: 0,
      failureCount: 23, // One below threshold of 24
      exchange: { slug: 'binance_us' }
    } as ExchangeSymbolMap;

    ohlcService.getActiveSymbolMaps.mockResolvedValue([mapping]);
    exchangeOHLC.fetchOHLC.mockResolvedValue({ success: false, candles: [] });
    jest.spyOn(task as any, 'sleep').mockResolvedValue(undefined);

    const job = { updateProgress: jest.fn(), name: 'ohlc-sync', id: 'job-1' } as unknown as Job;
    await task.handleOHLCSync(job);

    expect(ohlcService.incrementFailureCount).toHaveBeenCalledWith('map-1');
    // failureCount (23) + 1 >= 24 → should deactivate
    expect(ohlcService.updateSymbolMapStatus).toHaveBeenCalledWith('map-1', false);
  });

  it('does not deactivate mapping when failures are below threshold', async () => {
    const mapping = {
      id: 'map-2',
      coinId: 'eth',
      exchangeId: 'ex-1',
      symbol: 'ETH/USD',
      priority: 0,
      failureCount: 5,
      exchange: { slug: 'binance_us' }
    } as ExchangeSymbolMap;

    ohlcService.getActiveSymbolMaps.mockResolvedValue([mapping]);
    exchangeOHLC.fetchOHLC.mockResolvedValue({ success: false, candles: [] });
    jest.spyOn(task as any, 'sleep').mockResolvedValue(undefined);

    const job = { updateProgress: jest.fn(), name: 'ohlc-sync', id: 'job-1' } as unknown as Job;
    await task.handleOHLCSync(job);

    expect(ohlcService.incrementFailureCount).toHaveBeenCalledWith('map-2');
    // failureCount (5) + 1 = 6 < 24 → should NOT deactivate
    expect(ohlcService.updateSymbolMapStatus).not.toHaveBeenCalled();
  });

  it('deactivates mapping when sync throws an exception', async () => {
    const mapping = {
      id: 'map-3',
      coinId: 'sol',
      exchangeId: 'ex-1',
      symbol: 'SOL/USD',
      priority: 0,
      failureCount: 23,
      exchange: { slug: 'binance_us' }
    } as ExchangeSymbolMap;

    ohlcService.getActiveSymbolMaps.mockResolvedValue([mapping]);
    exchangeOHLC.fetchOHLC.mockRejectedValue(new Error('Exchange timeout'));
    jest.spyOn(task as any, 'sleep').mockResolvedValue(undefined);

    const job = { updateProgress: jest.fn(), name: 'ohlc-sync', id: 'job-1' } as unknown as Job;
    await task.handleOHLCSync(job);

    expect(ohlcService.incrementFailureCount).toHaveBeenCalledWith('map-3');
    expect(ohlcService.updateSymbolMapStatus).toHaveBeenCalledWith('map-3', false);
  });

  it('process calls handleOHLCSync', async () => {
    const handleSpy = jest.spyOn(task, 'handleOHLCSync').mockResolvedValue({
      totalMappings: 0,
      totalCoins: 0,
      processed: 0,
      successCount: 0,
      errorCount: 0
    });
    const job = { name: 'ohlc-sync', id: 'job-1' } as Job;

    await task.process(job);

    expect(handleSpy).toHaveBeenCalledWith(job);
  });
});
