import { Job } from 'bullmq';

import { CoinDetailSyncService } from './coin-detail-sync.service';
import { CoinSyncTask } from './coin-sync.task';

import { ExchangeService } from '../../exchange/exchange.service';
import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { CoinDailySnapshotService } from '../coin-daily-snapshot.service';
import { CoinListingEventService } from '../coin-listing-event.service';
import { CoinMarketDataService } from '../coin-market-data.service';
import { CoinService } from '../coin.service';

// Mock CoinGecko SDK calls
const mockCoinList = jest.fn();
const mockExchangeIdTickers = jest.fn();

describe('CoinSyncTask', () => {
  let task: CoinSyncTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let coinService: jest.Mocked<
    Pick<CoinService, 'getCoins' | 'createMany' | 'update' | 'removeMany' | 'relistMany' | 'clearRank'>
  >;
  let exchangeService: jest.Mocked<Pick<ExchangeService, 'getExchanges'>>;
  let listingEventService: jest.Mocked<Pick<CoinListingEventService, 'recordBulkDelistings' | 'recordBulkRelistings'>>;
  let coinDetailSync: jest.Mocked<Pick<CoinDetailSyncService, 'syncCoinDetails'>>;
  let snapshotService: jest.Mocked<
    Pick<CoinDailySnapshotService, 'captureSnapshots' | 'getCoinsNeedingBackfill' | 'backfillFromHistoricalData'>
  >;
  let coinMarketData: jest.Mocked<Pick<CoinMarketDataService, 'getCoinHistoricalData'>>;
  let geckoService: CoinGeckoClientService;

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();

    // Eliminate rate-limit delay in tests (scoped per test)
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      fn();
      return 0 as any;
    });

    queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue(undefined)
    };

    coinService = {
      getCoins: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      removeMany: jest.fn().mockResolvedValue(undefined),
      relistMany: jest.fn().mockResolvedValue(undefined),
      clearRank: jest.fn()
    } as any;

    exchangeService = {
      getExchanges: jest.fn().mockResolvedValue([])
    } as any;

    listingEventService = {
      recordBulkDelistings: jest.fn().mockResolvedValue(undefined),
      recordBulkRelistings: jest.fn().mockResolvedValue(undefined)
    } as any;

    coinDetailSync = {
      syncCoinDetails: jest.fn().mockResolvedValue({ totalCoins: 0, updatedSuccessfully: 0, errors: 0 })
    } as any;

    snapshotService = {
      captureSnapshots: jest.fn().mockResolvedValue(5),
      getCoinsNeedingBackfill: jest.fn().mockResolvedValue([]),
      backfillFromHistoricalData: jest.fn().mockResolvedValue(30)
    } as any;

    coinMarketData = {
      getCoinHistoricalData: jest.fn().mockResolvedValue([])
    } as any;

    geckoService = {
      client: {
        coins: {
          list: { get: mockCoinList }
        },
        exchanges: {
          tickers: { get: mockExchangeIdTickers }
        }
      }
    } as unknown as CoinGeckoClientService;

    task = new CoinSyncTask(
      queue as any,
      coinService as any,
      exchangeService as any,
      listingEventService as any,
      coinDetailSync as any,
      snapshotService as any,
      coinMarketData as any,
      geckoService,
      { acquire: jest.fn().mockResolvedValue({ acquired: true, lockId: 'test' }), release: jest.fn() } as any
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('skips scheduling in development', async () => {
      process.env.NODE_ENV = 'development';

      await task.onModuleInit();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips scheduling when DISABLE_BACKGROUND_TASKS is true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'true';

      await task.onModuleInit();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('schedules both coin-sync and coin-detail jobs in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';

      await task.onModuleInit();

      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledWith(
        'coin-sync',
        expect.objectContaining({ description: expect.stringContaining('coin-sync') }),
        expect.objectContaining({
          attempts: 3,
          repeat: { pattern: expect.any(String) },
          backoff: { type: 'exponential', delay: 5000 }
        })
      );
      expect(queue.add).toHaveBeenCalledWith(
        'coin-detail',
        expect.objectContaining({ description: expect.stringContaining('coin-detail') }),
        expect.objectContaining({ attempts: 3, repeat: { pattern: expect.any(String) } })
      );
    });

    it('skips scheduling if jobs already exist', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';
      queue.getRepeatableJobs.mockResolvedValue([
        { name: 'coin-sync', pattern: '0 0 * * 0' },
        { name: 'coin-detail', pattern: '0 23 * * *' }
      ]);

      await task.onModuleInit();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('schedules only the missing job when one already exists', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';
      queue.getRepeatableJobs.mockResolvedValue([{ name: 'coin-sync', pattern: '0 0 * * 0' }]);

      await task.onModuleInit();

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith('coin-detail', expect.any(Object), expect.any(Object));
    });

    it('does not schedule again on second call (jobScheduled guard)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';

      await task.onModuleInit();
      await task.onModuleInit();

      expect(queue.add).toHaveBeenCalledTimes(2); // only first call
    });
  });

  describe('process', () => {
    it('routes coin-sync to handleSyncCoins', async () => {
      const spy = jest
        .spyOn(task, 'handleSyncCoins')
        .mockResolvedValue({ added: 0, updated: 0, delisted: 0, relisted: 0, total: 0 });
      const job = { name: 'coin-sync', id: 'job-1' } as Job;

      const result = await task.process(job);

      expect(spy).toHaveBeenCalledWith(job);
      expect(result).toEqual({ added: 0, updated: 0, delisted: 0, relisted: 0, total: 0 });
    });

    it('routes coin-detail to handleCoinDetail', async () => {
      const expected = { totalCoins: 5, updatedSuccessfully: 4, errors: 1, snapshotsCaptured: 5 };
      const spy = jest.spyOn(task, 'handleCoinDetail').mockResolvedValue(expected);
      const job = { name: 'coin-detail', id: 'job-2' } as Job;

      const result = await task.process(job);

      expect(spy).toHaveBeenCalledWith(job);
      expect(result).toEqual(expected);
    });

    it('throws on unknown job name', async () => {
      const job = { name: 'unknown', id: 'job-3' } as Job;

      await expect(task.process(job)).rejects.toThrow('Unknown job name: unknown');
    });

    it('rethrows errors from handlers', async () => {
      const error = new Error('sync failed');
      jest.spyOn(task, 'handleSyncCoins').mockRejectedValue(error);
      const job = { name: 'coin-sync', id: 'job-4' } as Job;

      await expect(task.process(job)).rejects.toThrow(error);
    });
  });

  describe('handleSyncCoins', () => {
    const makeJob = () =>
      ({
        updateProgress: jest.fn(),
        name: 'coin-sync',
        id: 'sync-1'
      }) as unknown as Job;

    it('adds new coins, updates changed coins, delists stale coins', async () => {
      const existingCoins = [
        { id: 'id-1', slug: 'bitcoin', symbol: 'btc', name: 'Bitcoin', delistedAt: null },
        { id: 'id-2', slug: 'old-coin', symbol: 'old', name: 'OldCoin', delistedAt: null }
      ];
      coinService.getCoins.mockResolvedValue(existingCoins as any);

      mockCoinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin Updated' },
        { id: 'ethereum', symbol: 'eth', name: 'Ethereum' }
      ]);

      exchangeService.getExchanges.mockResolvedValue([{ slug: 'binance', name: 'Binance' }] as any);

      mockExchangeIdTickers.mockResolvedValueOnce({
        tickers: [{ coin_id: 'ethereum' }, { coin_id: 'bitcoin' }]
      });
      mockExchangeIdTickers.mockResolvedValueOnce({ tickers: [] });

      const job = makeJob();
      const result = await task.handleSyncCoins(job);

      // ethereum is new + in ticker pairs → added
      expect(coinService.createMany).toHaveBeenCalledWith([{ slug: 'ethereum', symbol: 'eth', name: 'Ethereum' }]);
      // bitcoin name changed → updated
      expect(coinService.update).toHaveBeenCalledWith('id-1', { name: 'Bitcoin Updated', symbol: 'btc' });
      // old-coin not in gecko → delisted
      expect(coinService.removeMany).toHaveBeenCalled();
      expect(listingEventService.recordBulkDelistings).toHaveBeenCalled();
      expect(result).toEqual({ added: 1, updated: 1, delisted: 1, relisted: 0, total: 2 });
    });

    it('delists existing coins not found in any ticker pairs', async () => {
      const existingCoins = [
        { id: 'id-1', slug: 'bitcoin', symbol: 'btc', name: 'Bitcoin', delistedAt: null },
        { id: 'id-2', slug: 'litecoin', symbol: 'ltc', name: 'Litecoin', delistedAt: null }
      ];
      coinService.getCoins.mockResolvedValue(existingCoins as any);

      // Both coins exist in gecko
      mockCoinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
        { id: 'litecoin', symbol: 'ltc', name: 'Litecoin' }
      ]);

      exchangeService.getExchanges.mockResolvedValue([{ slug: 'binance', name: 'Binance' }] as any);

      // Only bitcoin is in ticker pairs, litecoin is not
      mockExchangeIdTickers.mockResolvedValueOnce({
        tickers: [{ coin_id: 'bitcoin' }]
      });
      mockExchangeIdTickers.mockResolvedValueOnce({ tickers: [] });

      const job = makeJob();
      const result = await task.handleSyncCoins(job);

      expect(coinService.removeMany).toHaveBeenCalledWith(['id-2']);
      expect(listingEventService.recordBulkDelistings).toHaveBeenCalledWith(['id-2'], 'coin_sync');
      expect(result.delisted).toBe(1);
    });

    it('re-lists previously delisted coins and records listing events', async () => {
      const existingCoins = [
        { id: 'id-1', slug: 'bitcoin', symbol: 'btc', name: 'Bitcoin', delistedAt: null },
        {
          id: 'id-relisted',
          slug: 'relisted-coin',
          symbol: 'rls',
          name: 'RelistedCoin',
          delistedAt: new Date('2026-01-01')
        }
      ];
      coinService.getCoins.mockResolvedValue(existingCoins as any);

      mockCoinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
        { id: 'relisted-coin', symbol: 'rls', name: 'RelistedCoin' }
      ]);

      exchangeService.getExchanges.mockResolvedValue([{ slug: 'binance', name: 'Binance' }] as any);

      mockExchangeIdTickers.mockResolvedValueOnce({
        tickers: [{ coin_id: 'bitcoin' }, { coin_id: 'relisted-coin' }]
      });
      mockExchangeIdTickers.mockResolvedValueOnce({ tickers: [] });

      const job = makeJob();
      const result = await task.handleSyncCoins(job);

      expect(coinService.relistMany).toHaveBeenCalledWith(['id-relisted']);
      expect(listingEventService.recordBulkRelistings).toHaveBeenCalledWith(['id-relisted'], 'coin_sync');
      expect(result.relisted).toBe(1);
    });

    it('continues updating remaining coins when one update fails', async () => {
      const existingCoins = [
        { id: 'id-1', slug: 'bitcoin', symbol: 'btc', name: 'Bitcoin', delistedAt: null },
        { id: 'id-2', slug: 'ethereum', symbol: 'eth', name: 'Ethereum', delistedAt: null }
      ];
      coinService.getCoins.mockResolvedValue(existingCoins as any);

      mockCoinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin v2' },
        { id: 'ethereum', symbol: 'eth', name: 'Ethereum v2' }
      ]);

      exchangeService.getExchanges.mockResolvedValue([{ slug: 'binance', name: 'Binance' }] as any);
      mockExchangeIdTickers.mockResolvedValueOnce({
        tickers: [{ coin_id: 'bitcoin' }, { coin_id: 'ethereum' }]
      });
      mockExchangeIdTickers.mockResolvedValueOnce({ tickers: [] });

      // First update fails, second succeeds
      coinService.update.mockRejectedValueOnce(new Error('DB error')).mockResolvedValueOnce(undefined as any);

      const job = makeJob();
      const result = await task.handleSyncCoins(job);

      expect(coinService.update).toHaveBeenCalledTimes(2);
      expect(result.updated).toBe(2); // counts attempted, not successful
    });

    it('returns correct counts when nothing changes', async () => {
      coinService.getCoins.mockResolvedValue([]);
      mockCoinList.mockResolvedValue([]);
      exchangeService.getExchanges.mockResolvedValue([]);

      const result = await task.handleSyncCoins(makeJob());

      expect(result).toEqual({ added: 0, updated: 0, delisted: 0, relisted: 0, total: 0 });
    });

    it('sets progress to 100 even when sync throws', async () => {
      coinService.getCoins.mockRejectedValue(new Error('DB down'));
      mockCoinList.mockResolvedValue([]);
      exchangeService.getExchanges.mockResolvedValue([]);

      const job = makeJob();
      await expect(task.handleSyncCoins(job)).rejects.toThrow('DB down');
      expect(job.updateProgress).toHaveBeenCalledWith(100);
    });

    it('maps coinbase exchange slug to gdax for CoinGecko API', async () => {
      coinService.getCoins.mockResolvedValue([]);
      mockCoinList.mockResolvedValue([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }]);
      exchangeService.getExchanges.mockResolvedValue([{ slug: 'coinbase', name: 'Coinbase' }] as any);

      mockExchangeIdTickers.mockResolvedValueOnce({
        tickers: [{ coin_id: 'bitcoin' }]
      });
      mockExchangeIdTickers.mockResolvedValueOnce({ tickers: [] });

      await task.handleSyncCoins(makeJob());

      expect(mockExchangeIdTickers).toHaveBeenCalledWith('gdax', expect.objectContaining({ page: 1 }));
    });

    it('collects both base and target coin IDs from tickers', async () => {
      coinService.getCoins.mockResolvedValue([]);
      mockCoinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
        { id: 'tether', symbol: 'usdt', name: 'Tether' }
      ]);
      exchangeService.getExchanges.mockResolvedValue([{ slug: 'binance', name: 'Binance' }] as any);

      mockExchangeIdTickers.mockResolvedValueOnce({
        tickers: [{ coin_id: 'bitcoin', target_coin_id: 'tether' }]
      });
      mockExchangeIdTickers.mockResolvedValueOnce({ tickers: [] });

      const result = await task.handleSyncCoins(makeJob());

      // Both bitcoin (base) and tether (target) should be recognized as used
      expect(coinService.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ slug: 'bitcoin' }),
          expect.objectContaining({ slug: 'tether' })
        ])
      );
      expect(result.added).toBe(2);
    });

    it('skips exchange and continues when ticker fetch fails on first page', async () => {
      coinService.getCoins.mockResolvedValue([]);
      mockCoinList.mockResolvedValue([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }]);
      exchangeService.getExchanges.mockResolvedValue([
        { slug: 'bad-exchange', name: 'BadExchange' },
        { slug: 'binance', name: 'Binance' }
      ] as any);

      // First exchange fails on page 1
      mockExchangeIdTickers.mockRejectedValueOnce(new Error('API error'));
      // Second exchange works
      mockExchangeIdTickers.mockResolvedValueOnce({
        tickers: [{ coin_id: 'bitcoin' }]
      });
      mockExchangeIdTickers.mockResolvedValueOnce({ tickers: [] });

      const result = await task.handleSyncCoins(makeJob());

      expect(result.added).toBe(1); // bitcoin still added from second exchange
    });
  });

  describe('handleCoinDetail', () => {
    it('delegates to CoinDetailSyncService and returns its result with snapshots', async () => {
      const detailResult = { totalCoins: 5, updatedSuccessfully: 4, errors: 1 };
      coinDetailSync.syncCoinDetails.mockResolvedValue(detailResult);

      const job = { updateProgress: jest.fn(), name: 'coin-detail', id: 'detail-1' } as unknown as Job;
      const result = await task.handleCoinDetail(job);

      expect(coinDetailSync.syncCoinDetails).toHaveBeenCalledWith(expect.any(Function));
      expect(result).toEqual({ ...detailResult, snapshotsCaptured: 5 });
    });

    it('forwards progress to job.updateProgress', async () => {
      coinDetailSync.syncCoinDetails.mockImplementation(async (onProgress) => {
        await onProgress?.(50);
        return { totalCoins: 0, updatedSuccessfully: 0, errors: 0 };
      });

      const job = { updateProgress: jest.fn(), name: 'coin-detail', id: 'detail-2' } as unknown as Job;
      await task.handleCoinDetail(job);

      expect(job.updateProgress).toHaveBeenCalledWith(50);
    });

    it('rethrows errors from syncCoinDetails', async () => {
      const error = new Error('detail sync failed');
      coinDetailSync.syncCoinDetails.mockRejectedValue(error);

      const job = { updateProgress: jest.fn(), name: 'coin-detail', id: 'detail-3' } as unknown as Job;
      await expect(task.handleCoinDetail(job)).rejects.toThrow(error);
    });
  });

  describe('handleCoinDetail snapshots', () => {
    const freshCoins = [
      { id: 'id-btc', slug: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
      { id: 'id-eth', slug: 'ethereum', symbol: 'eth', name: 'Ethereum' }
    ];

    const makeJob = () =>
      ({
        updateProgress: jest.fn(),
        name: 'coin-detail',
        id: 'detail-snap-1'
      }) as unknown as Job;

    beforeEach(() => {
      coinService.getCoins.mockResolvedValue(freshCoins as any);
    });

    it('calls captureSnapshots after coin detail sync', async () => {
      const result = await task.handleCoinDetail(makeJob());

      expect(snapshotService.captureSnapshots).toHaveBeenCalledWith(freshCoins);
      expect(result).toEqual(
        expect.objectContaining({
          snapshotsCaptured: 5
        })
      );
    });

    it('continues successfully even if snapshot capture fails', async () => {
      snapshotService.captureSnapshots.mockRejectedValue(new Error('DB connection lost'));

      const result = await task.handleCoinDetail(makeJob());

      expect(result).toEqual(
        expect.objectContaining({
          totalCoins: expect.any(Number),
          snapshotsCaptured: 0
        })
      );
    });

    it('backfills coins that need historical snapshots', async () => {
      snapshotService.getCoinsNeedingBackfill.mockResolvedValue(['id-btc']);
      const historicalData = [
        { timestamp: 1704067200000, price: 42000, volume: 10_000_000_000, marketCap: 800_000_000_000 }
      ];
      coinMarketData.getCoinHistoricalData.mockResolvedValue(historicalData as any);

      await task.handleCoinDetail(makeJob());

      expect(snapshotService.getCoinsNeedingBackfill).toHaveBeenCalled();
      expect(coinMarketData.getCoinHistoricalData).toHaveBeenCalledWith('id-btc');
      expect(snapshotService.backfillFromHistoricalData).toHaveBeenCalledWith('id-btc', historicalData);
    });

    it('continues successfully even if backfill fails', async () => {
      snapshotService.getCoinsNeedingBackfill.mockRejectedValue(new Error('DB error'));

      const result = await task.handleCoinDetail(makeJob());

      expect(result).toEqual(
        expect.objectContaining({
          totalCoins: expect.any(Number),
          updatedSuccessfully: expect.any(Number)
        })
      );
    });

    it('skips backfill when no coins need it', async () => {
      snapshotService.getCoinsNeedingBackfill.mockResolvedValue([]);

      await task.handleCoinDetail(makeJob());

      expect(coinMarketData.getCoinHistoricalData).not.toHaveBeenCalled();
      expect(snapshotService.backfillFromHistoricalData).not.toHaveBeenCalled();
    });
  });
});
