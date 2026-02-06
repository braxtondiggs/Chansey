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
      markSyncSuccess: jest.fn()
    } as unknown as jest.Mocked<OHLCService>;

    exchangeOHLC = {
      fetchOHLC: jest.fn()
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
    jest.spyOn(task as any, 'scheduleOHLCSyncJob').mockResolvedValue(undefined);

    await task.onModuleInit();

    expect(ohlcService.upsertSymbolMap).toHaveBeenCalledWith({
      coinId: 'btc',
      exchangeId: 'ex-1',
      symbol: 'BTC/USD',
      isActive: true,
      priority: 0
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
