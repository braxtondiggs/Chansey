/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Cache } from 'cache-manager';

import { ExchangeOHLCService } from './exchange-ohlc.service';
import { ExchangeSymbolMapService } from './exchange-symbol-map.service';
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
  let symbolMapService: jest.Mocked<ExchangeSymbolMapService>;
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
      upsertCandles: jest.fn()
    } as unknown as jest.Mocked<OHLCService>;

    symbolMapService = {
      getActiveSymbolMaps: jest.fn(),
      upsertSymbolMap: jest.fn()
    } as unknown as jest.Mocked<ExchangeSymbolMapService>;

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
      symbolMapService,
      exchangeOHLC,
      coinService,
      exchangeService,
      configService as any
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startBackfill', () => {
    it('throws when coin not found', async () => {
      coinService.getCoinById.mockRejectedValue(new Error('not found'));

      await expect(service.startBackfill('btc')).rejects.toThrow('Coin not found: btc');
    });

    it('returns job ID and saves initial progress', async () => {
      coinService.getCoinById.mockResolvedValue({ id: 'btc', symbol: 'btc' } as any);
      jest.spyOn(service as any, 'performBackfill').mockResolvedValue(undefined);

      const jobId = await service.startBackfill('btc');

      expect(jobId).toMatch(/^backfill-btc-\d+$/);
      expect(cache.set).toHaveBeenCalledWith(
        'ohlc:backfill:btc',
        expect.stringContaining('"coinSymbol":"BTC/USD"'),
        expect.any(Number)
      );
    });

    it('uses provided start and end dates', async () => {
      coinService.getCoinById.mockResolvedValue({ id: 'btc', symbol: 'btc' } as any);
      const performSpy = jest.spyOn(service as any, 'performBackfill').mockResolvedValue(undefined);
      const start = new Date('2023-06-01T00:00:00Z');
      const end = new Date('2023-12-01T00:00:00Z');

      await service.startBackfill('btc', start, end);

      expect(performSpy).toHaveBeenCalledWith('btc', 'BTC/USD', start, end);
    });
  });

  describe('resumeBackfill', () => {
    it('throws when no progress exists', async () => {
      cache.get.mockResolvedValue(null);

      await expect(service.resumeBackfill('btc')).rejects.toThrow('No backfill progress found for coin: btc');
    });

    it('skips when status is completed', async () => {
      cache.get.mockResolvedValue(JSON.stringify(createProgress({ status: 'completed' })));
      const performSpy = jest.spyOn(service as any, 'performBackfill').mockResolvedValue(undefined);

      await service.resumeBackfill('btc');

      expect(performSpy).not.toHaveBeenCalled();
    });

    it('skips when status is in_progress', async () => {
      cache.get.mockResolvedValue(JSON.stringify(createProgress({ status: 'in_progress' })));
      const performSpy = jest.spyOn(service as any, 'performBackfill').mockResolvedValue(undefined);

      await service.resumeBackfill('btc');

      expect(performSpy).not.toHaveBeenCalled();
    });

    it('resumes from currentDate for a failed job', async () => {
      const progress = createProgress({
        status: 'failed',
        currentDate: new Date('2024-01-01T12:00:00Z'),
        endDate: new Date('2024-01-02T00:00:00Z')
      });
      cache.get.mockResolvedValue(JSON.stringify(progress));
      const performSpy = jest.spyOn(service as any, 'performBackfill').mockResolvedValue(undefined);

      await service.resumeBackfill('btc');

      expect(performSpy).toHaveBeenCalledWith(
        'btc',
        'BTC/USD',
        new Date('2024-01-01T12:00:00Z'),
        new Date('2024-01-02T00:00:00Z')
      );
    });

    it('clears cancelled flag before resuming', async () => {
      (service as any).cancelledJobs.add('btc');
      cache.get.mockResolvedValue(JSON.stringify(createProgress({ status: 'cancelled' })));
      jest.spyOn(service as any, 'performBackfill').mockResolvedValue(undefined);

      await service.resumeBackfill('btc');

      expect((service as any).cancelledJobs.has('btc')).toBe(false);
    });
  });

  describe('getProgress', () => {
    it('returns null when no data exists', async () => {
      cache.get.mockResolvedValue(null);

      expect(await service.getProgress('btc')).toBeNull();
    });

    it('deserializes JSON strings back to Date objects', async () => {
      cache.get.mockResolvedValue(JSON.stringify(createProgress()));

      const result = await service.getProgress('btc');

      expect(result!.startDate).toBeInstanceOf(Date);
      expect(result!.endDate).toBeInstanceOf(Date);
      expect(result!.currentDate).toBeInstanceOf(Date);
      expect(result!.startedAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('getAllProgress', () => {
    it('returns only pending and in_progress jobs', async () => {
      symbolMapService.getActiveSymbolMaps.mockResolvedValue([
        { coinId: 'btc' },
        { coinId: 'eth' },
        { coinId: 'sol' }
      ] as any);

      cache.get
        .mockResolvedValueOnce(JSON.stringify(createProgress({ coinId: 'btc', status: 'in_progress' })))
        .mockResolvedValueOnce(JSON.stringify(createProgress({ coinId: 'eth', status: 'completed' })))
        .mockResolvedValueOnce(JSON.stringify(createProgress({ coinId: 'sol', status: 'pending' })));

      const result = await service.getAllProgress();

      expect(result).toHaveLength(2);
      expect(result.map((p) => p.coinId)).toEqual(['btc', 'sol']);
    });

    it('returns empty when no active jobs', async () => {
      symbolMapService.getActiveSymbolMaps.mockResolvedValue([]);

      const result = await service.getAllProgress();

      expect(result).toEqual([]);
    });
  });

  describe('cancelBackfill', () => {
    it('adds to cancelled set and updates status', async () => {
      cache.get.mockResolvedValue(JSON.stringify(createProgress()));

      await service.cancelBackfill('btc');

      expect((service as any).cancelledJobs.has('btc')).toBe(true);
      // Verify updateProgress was called — cache.get + cache.set for the update
      expect(cache.set).toHaveBeenCalledWith(
        'ohlc:backfill:btc',
        expect.stringContaining('"status":"cancelled"'),
        expect.any(Number)
      );
    });
  });

  describe('performBackfill', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
      // Default: cache stores progress so updateProgress can read it back
      cache.get.mockResolvedValue(JSON.stringify(createProgress()));
    });

    it('fetches candles in a loop and upserts them', async () => {
      const candle = {
        timestamp: new Date('2024-01-01T01:00:00Z').getTime(),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100
      };
      exchangeOHLC.fetchOHLCWithFallback
        .mockResolvedValueOnce({ success: true, candles: [candle], exchangeSlug: 'binance_us' })
        .mockResolvedValueOnce({ success: true, candles: [], exchangeSlug: 'binance_us' });

      exchangeService.getExchanges.mockResolvedValue([{ id: 'ex-1', slug: 'binance_us' }] as any);

      await (service as any).performBackfill(
        'btc',
        'BTC/USD',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T02:00:00Z')
      );

      expect(ohlcService.upsertCandles).toHaveBeenCalledWith([
        expect.objectContaining({ coinId: 'btc', exchangeId: 'ex-1', open: 1, close: 1.5 })
      ]);
    });

    it('skips forward when no candles returned', async () => {
      exchangeOHLC.fetchOHLCWithFallback
        .mockResolvedValueOnce({ success: true, candles: [], exchangeSlug: 'binance_us' })
        .mockResolvedValueOnce({ success: true, candles: [], exchangeSlug: 'binance_us' });

      await (service as any).performBackfill(
        'btc',
        'BTC/USD',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T01:30:00Z')
      );

      expect(ohlcService.upsertCandles).not.toHaveBeenCalled();
      // Should have advanced past the end date after 2 one-hour skips
      expect(exchangeOHLC.fetchOHLCWithFallback).toHaveBeenCalledTimes(2);
    });

    it('stops when cancelled mid-loop', async () => {
      (service as any).cancelledJobs.add('btc');

      await (service as any).performBackfill(
        'btc',
        'BTC/USD',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-02T00:00:00Z')
      );

      expect(exchangeOHLC.fetchOHLCWithFallback).not.toHaveBeenCalled();
    });

    it('saves failed status and rethrows on error', async () => {
      exchangeOHLC.fetchOHLCWithFallback.mockRejectedValue(new Error('rate limited'));

      await expect(
        (service as any).performBackfill(
          'btc',
          'BTC/USD',
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-02T00:00:00Z')
        )
      ).rejects.toThrow('rate limited');

      expect(cache.set).toHaveBeenCalledWith(
        'ohlc:backfill:btc',
        expect.stringContaining('"status":"failed"'),
        expect.any(Number)
      );
    });

    it('marks status as completed when loop finishes', async () => {
      exchangeOHLC.fetchOHLCWithFallback.mockResolvedValue({ success: true, candles: [], exchangeSlug: 'binance_us' });

      await (service as any).performBackfill(
        'btc',
        'BTC/USD',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T00:30:00Z')
      );

      expect(cache.set).toHaveBeenCalledWith(
        'ohlc:backfill:btc',
        expect.stringContaining('"status":"completed"'),
        expect.any(Number)
      );
    });
  });

  describe('backfillHotCoins', () => {
    it('creates symbol maps and starts backfill for each coin', async () => {
      const coins = [
        { id: 'btc', symbol: 'BTC' },
        { id: 'eth', symbol: 'ETH' }
      ];
      coinService.getPopularCoins.mockResolvedValue(coins as any);
      exchangeService.getExchanges.mockResolvedValue([{ id: 'ex-1', slug: 'binance_us' }] as any);
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
      const startSpy = jest.spyOn(service, 'startBackfill').mockResolvedValue('job');

      const result = await service.backfillHotCoins();

      expect(symbolMapService.upsertSymbolMap).toHaveBeenCalledTimes(2);
      expect(symbolMapService.upsertSymbolMap).toHaveBeenCalledWith(
        expect.objectContaining({ coinId: 'btc', symbol: 'BTC/USD' })
      );
      expect(startSpy).toHaveBeenCalledTimes(2);
      expect(result).toBe(2);
    });

    it('throws when no supported exchange found', async () => {
      coinService.getPopularCoins.mockResolvedValue([{ id: 'btc', symbol: 'BTC' }] as any);
      exchangeService.getExchanges.mockResolvedValue([]);

      await expect(service.backfillHotCoins()).rejects.toThrow('No supported exchange found for backfill');
    });

    it('continues processing when individual coin fails', async () => {
      const coins = [
        { id: 'btc', symbol: 'BTC' },
        { id: 'eth', symbol: 'ETH' }
      ];
      coinService.getPopularCoins.mockResolvedValue(coins as any);
      exchangeService.getExchanges.mockResolvedValue([{ id: 'ex-1', slug: 'binance_us' }] as any);
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
      jest.spyOn(service, 'startBackfill').mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('job');

      const result = await service.backfillHotCoins();

      // Should still return total count — errors are caught per-coin
      expect(result).toBe(2);
    });
  });
});
