import { MarketRegimeTask } from './market-regime.task';

import { CoinService } from '../coin/coin.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { OHLCService } from '../ohlc/ohlc.service';
import { OHLCBackfillService } from '../ohlc/services/ohlc-backfill.service';

describe('MarketRegimeTask', () => {
  let task: MarketRegimeTask;
  let regimeQueue: { add: jest.Mock; getJobCounts: jest.Mock };
  let marketRegimeService: jest.Mocked<Pick<MarketRegimeService, 'detectRegime'>>;
  let compositeRegimeService: jest.Mocked<Pick<CompositeRegimeService, 'refresh'>>;
  let ohlcService: jest.Mocked<Pick<OHLCService, 'findAllByDay'>>;
  let coinService: jest.Mocked<Pick<CoinService, 'getCoinBySymbol'>>;
  let backfillService: jest.Mocked<Pick<OHLCBackfillService, 'getProgress' | 'startBackfill'>>;

  const mockCoin = { id: 'btc-id' } as any;

  function makeSummaries(count: number, closeFactory: (i: number) => number = (i) => count - i) {
    return Array.from({ length: count }, (_, i) => ({
      coin: 'btc-id',
      date: new Date(2025, 0, i + 1),
      close: closeFactory(i),
      avg: count - i,
      high: count - i + 5,
      low: count - i - 5
    }));
  }

  beforeEach(() => {
    regimeQueue = {
      add: jest.fn().mockResolvedValue(undefined),
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 })
    };

    marketRegimeService = { detectRegime: jest.fn().mockResolvedValue(undefined) } as any;
    compositeRegimeService = { refresh: jest.fn().mockResolvedValue(undefined) } as any;
    ohlcService = { findAllByDay: jest.fn().mockResolvedValue({}) } as any;
    coinService = { getCoinBySymbol: jest.fn().mockResolvedValue(null) } as any;
    backfillService = {
      getProgress: jest.fn().mockResolvedValue(null),
      startBackfill: jest.fn().mockResolvedValue('job-id')
    } as any;

    task = new MarketRegimeTask(
      regimeQueue as any,
      marketRegimeService as any,
      compositeRegimeService as any,
      ohlcService as any,
      coinService as any,
      backfillService as any
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchPriceData', () => {
    it('returns null when coin not found', async () => {
      coinService.getCoinBySymbol.mockResolvedValue(null);

      const result = await (task as any).fetchPriceData('BTC');

      expect(result).toBeNull();
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('BTC', [], false);
    });

    it('returns null and triggers backfill when no OHLC data', async () => {
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);
      ohlcService.findAllByDay.mockResolvedValue({ 'btc-id': [] });

      const result = await (task as any).fetchPriceData('BTC');

      expect(result).toBeNull();
      expect(backfillService.startBackfill).toHaveBeenCalledWith('btc-id');
    });

    it('returns null on service error', async () => {
      coinService.getCoinBySymbol.mockRejectedValue(new Error('DB down'));

      expect(await (task as any).fetchPriceData('BTC')).toBeNull();
    });

    it('reverses to chronological order and trims to 365 days', async () => {
      // 400 descending closes: 400, 399, ..., 1
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);
      ohlcService.findAllByDay.mockResolvedValue({ 'btc-id': makeSummaries(400) });

      const result = await (task as any).fetchPriceData('BTC');

      expect(result).toHaveLength(365);
      // After reverse: [1, 2, ..., 400], then slice(-365) → [36..400]
      expect(result[0]).toBe(36);
      expect(result[364]).toBe(400);
    });

    it('returns null and triggers backfill when insufficient data', async () => {
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);
      ohlcService.findAllByDay.mockResolvedValue({ 'btc-id': makeSummaries(100) });

      const result = await (task as any).fetchPriceData('BTC');

      expect(result).toBeNull();
      expect(backfillService.startBackfill).toHaveBeenCalledWith('btc-id');
    });

    it('skips backfill when one is already in progress', async () => {
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);
      ohlcService.findAllByDay.mockResolvedValue({ 'btc-id': makeSummaries(100) });
      backfillService.getProgress.mockResolvedValue({ status: 'in_progress' } as any);

      const result = await (task as any).fetchPriceData('BTC');

      expect(result).toBeNull();
      expect(backfillService.startBackfill).not.toHaveBeenCalled();
    });

    it('skips backfill when previous backfill failed (cooldown via Redis TTL)', async () => {
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);
      ohlcService.findAllByDay.mockResolvedValue({ 'btc-id': makeSummaries(100) });
      backfillService.getProgress.mockResolvedValue({ status: 'failed' } as any);

      const result = await (task as any).fetchPriceData('BTC');

      expect(result).toBeNull();
      expect(backfillService.startBackfill).not.toHaveBeenCalled();
    });

    it('returns null without triggering backfill when getProgress throws', async () => {
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);
      ohlcService.findAllByDay.mockResolvedValue({ 'btc-id': makeSummaries(100) });
      backfillService.getProgress.mockRejectedValue(new Error('Redis down'));

      const result = await (task as any).fetchPriceData('BTC');

      expect(result).toBeNull();
      expect(backfillService.startBackfill).not.toHaveBeenCalled();
    });

    it('filters out non-finite close values', async () => {
      // 370 valid closes + 3 non-finite = 373 total summaries, 370 finite >= 365
      const summaries = makeSummaries(373, (i) => {
        if (i === 5) return NaN;
        if (i === 10) return Infinity;
        if (i === 15) return -Infinity;
        return 373 - i;
      });
      coinService.getCoinBySymbol.mockResolvedValue(mockCoin);
      ohlcService.findAllByDay.mockResolvedValue({ 'btc-id': summaries });

      const result = await (task as any).fetchPriceData('BTC');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(365);
      expect((result as number[]).every((v: number) => Number.isFinite(v))).toBe(true);
    });
  });

  describe('processRegimeCheck', () => {
    it('calls detectRegime with price data on happy path', async () => {
      const closes = [100, 101, 102];
      jest.spyOn(task as any, 'fetchPriceData').mockResolvedValue(closes);

      await task.processRegimeCheck('BTC');

      expect(marketRegimeService.detectRegime).toHaveBeenCalledWith('BTC', closes);
    });

    it('skips detectRegime when price data is null', async () => {
      jest.spyOn(task as any, 'fetchPriceData').mockResolvedValue(null);

      await task.processRegimeCheck('BTC');

      expect(marketRegimeService.detectRegime).not.toHaveBeenCalled();
    });

    it('re-throws errors from detectRegime', async () => {
      jest.spyOn(task as any, 'fetchPriceData').mockResolvedValue([100, 101]);
      marketRegimeService.detectRegime.mockRejectedValue(new Error('regime error'));

      await expect(task.processRegimeCheck('BTC')).rejects.toThrow('regime error');
    });
  });

  describe('scheduleRegimeCheck', () => {
    it('queues all 4 monitored assets with correct job config', async () => {
      await task.scheduleRegimeCheck();

      expect(regimeQueue.add).toHaveBeenCalledTimes(4);
      for (const asset of ['BTC', 'ETH', 'SOL', 'POL']) {
        expect(regimeQueue.add).toHaveBeenCalledWith(
          'check-regime',
          expect.objectContaining({ asset }),
          expect.objectContaining({
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: true,
            removeOnFail: 50
          })
        );
      }
      expect(compositeRegimeService.refresh).toHaveBeenCalled();
    });

    it('catches composite refresh error without throwing', async () => {
      compositeRegimeService.refresh.mockRejectedValue(new Error('refresh failed'));

      await expect(task.scheduleRegimeCheck()).resolves.not.toThrow();
    });
  });

  describe('queueRegimeCheck', () => {
    it('catches queue.add error without throwing', async () => {
      regimeQueue.add.mockRejectedValue(new Error('queue down'));

      await expect(task.queueRegimeCheck('BTC')).resolves.not.toThrow();
    });
  });
});
