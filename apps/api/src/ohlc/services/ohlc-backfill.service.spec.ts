import { Cache } from 'cache-manager';

import { ExchangeOHLCService } from './exchange-ohlc.service';
import { OHLCBackfillService } from './ohlc-backfill.service';

import { CoinService } from '../../coin/coin.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { OHLCService } from '../ohlc.service';

const createProgress = (overrides: Partial<any> = {}) => ({
  coinId: 'btc',
  coinSymbol: 'BTC/USD',
  startDate: new Date('2024-01-01T00:00:00Z'),
  endDate: new Date('2024-01-02T00:00:00Z'),
  currentDate: new Date('2024-01-01T00:00:00Z'),
  candlesBackfilled: 0,
  percentComplete: 0,
  status: 'pending',
  startedAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides
});

describe('OHLCBackfillService', () => {
  let service: OHLCBackfillService;
  let cache: jest.Mocked<Cache>;
  let ohlcService: jest.Mocked<OHLCService>;
  let exchangeOHLC: jest.Mocked<ExchangeOHLCService>;
  let coinService: jest.Mocked<CoinService>;
  let exchangeService: jest.Mocked<ExchangeService>;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn()
    } as unknown as jest.Mocked<Cache>;

    ohlcService = {
      getActiveSymbolMaps: jest.fn(),
      upsertSymbolMap: jest.fn(),
      upsertCandles: jest.fn()
    } as unknown as jest.Mocked<OHLCService>;

    exchangeOHLC = {
      fetchOHLCWithFallback: jest.fn()
    } as unknown as jest.Mocked<ExchangeOHLCService>;

    coinService = {
      getCoinById: jest.fn(),
      getPopularCoins: jest.fn()
    } as unknown as jest.Mocked<CoinService>;

    exchangeService = {
      getExchanges: jest.fn()
    } as unknown as jest.Mocked<ExchangeService>;

    configService = {
      get: jest.fn()
    };

    service = new OHLCBackfillService(
      cache,
      ohlcService,
      exchangeOHLC,
      coinService,
      exchangeService,
      configService as any
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('startBackfill throws when coin not found', async () => {
    coinService.getCoinById.mockRejectedValue(new Error('not found'));

    await expect(service.startBackfill('btc')).rejects.toThrow('Coin not found');
  });

  it('startBackfill stores progress and kicks off backfill', async () => {
    coinService.getCoinById.mockResolvedValue({ id: 'btc', symbol: 'btc' } as any);
    const performSpy = jest.spyOn(service as any, 'performBackfill').mockResolvedValue(undefined);

    const jobId = await service.startBackfill('btc');

    expect(jobId).toMatch(/^backfill-btc-/);
    expect(cache.set).toHaveBeenCalled();
    expect(performSpy).toHaveBeenCalled();
  });

  it('resumeBackfill throws when no progress', async () => {
    cache.get.mockResolvedValue(null);

    await expect(service.resumeBackfill('btc')).rejects.toThrow('No backfill progress found');
  });

  it('resumeBackfill ignores completed progress', async () => {
    const progress = createProgress({ status: 'completed' });
    cache.get.mockResolvedValue(JSON.stringify(progress));
    const performSpy = jest.spyOn(service as any, 'performBackfill').mockResolvedValue(undefined);

    await service.resumeBackfill('btc');

    expect(performSpy).not.toHaveBeenCalled();
  });

  it('cancelBackfill marks job as cancelled', async () => {
    const progress = createProgress();
    cache.get.mockResolvedValue(JSON.stringify(progress));
    const updateSpy = jest.spyOn(service as any, 'updateProgress').mockResolvedValue(undefined);

    await service.cancelBackfill('btc');

    expect((service as any).cancelledJobs.has('btc')).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith('btc', { status: 'cancelled' });
  });

  it('backfillHotCoins starts backfill for popular coins in batches', async () => {
    const coins = [
      { id: 'btc', symbol: 'BTC' },
      { id: 'eth', symbol: 'ETH' }
    ];

    coinService.getPopularCoins.mockResolvedValue(coins as any);
    exchangeService.getExchanges.mockResolvedValue([{ id: 'ex-1', slug: 'binance_us' }] as any);

    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    const startSpy = jest.spyOn(service, 'startBackfill').mockResolvedValue('job');

    const result = await service.backfillHotCoins();

    expect(coinService.getPopularCoins).toHaveBeenCalled();
    expect(ohlcService.upsertSymbolMap).toHaveBeenCalledTimes(2);
    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(result).toBe(2);
  });
});
