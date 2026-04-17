import { type Job } from 'bullmq';

import { type CoinDetailSyncService } from './coin-detail-sync.service';
import { CoinSyncTask } from './coin-sync.task';

import { type ExchangeService } from '../../exchange/exchange.service';
import { type CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { type CoinDailySnapshotService } from '../coin-daily-snapshot.service';
import { type CoinListingEventService } from '../coin-listing-event.service';
import { type CoinMarketDataService } from '../coin-market-data.service';
import { type CoinService } from '../coin.service';
import { type ExchangeTickerFetcherService } from '../ticker-pairs/services/exchange-ticker-fetcher.service';

// Mock CoinGecko SDK calls
const mockCoinList = jest.fn();

describe('CoinSyncTask', () => {
  let task: CoinSyncTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock; removeRepeatableByKey: jest.Mock };
  let coinService: jest.Mocked<
    Pick<
      CoinService,
      'getCoins' | 'createMany' | 'update' | 'removeMany' | 'relistMany' | 'clearRank' | 'markSnapshotBackfillComplete'
    >
  >;
  let exchangeService: jest.Mocked<Pick<ExchangeService, 'getExchanges'>>;
  let listingEventService: jest.Mocked<Pick<CoinListingEventService, 'recordBulkDelistings' | 'recordBulkRelistings'>>;
  let coinDetailSync: jest.Mocked<Pick<CoinDetailSyncService, 'syncCoinDetails' | 'syncCoinMetadata'>>;
  let snapshotService: jest.Mocked<
    Pick<CoinDailySnapshotService, 'captureSnapshots' | 'getCoinsNeedingBackfill' | 'backfillFromHistoricalData'>
  >;
  let coinMarketData: jest.Mocked<Pick<CoinMarketDataService, 'getCoinHistoricalData'>>;
  let tickerFetcher: jest.Mocked<Pick<ExchangeTickerFetcherService, 'fetchAllTickersForExchange'>>;
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
      add: jest.fn().mockResolvedValue(undefined),
      removeRepeatableByKey: jest.fn().mockResolvedValue(true)
    };

    coinService = {
      getCoins: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      removeMany: jest.fn().mockResolvedValue(undefined),
      relistMany: jest.fn().mockResolvedValue(undefined),
      clearRank: jest.fn(),
      markSnapshotBackfillComplete: jest.fn().mockResolvedValue(undefined)
    } as any;

    exchangeService = {
      getExchanges: jest.fn().mockResolvedValue([])
    } as any;

    listingEventService = {
      recordBulkDelistings: jest.fn().mockResolvedValue(undefined),
      recordBulkRelistings: jest.fn().mockResolvedValue(undefined)
    } as any;

    coinDetailSync = {
      syncCoinDetails: jest.fn().mockResolvedValue({ totalCoins: 0, updatedSuccessfully: 0, errors: 0 }),
      syncCoinMetadata: jest.fn().mockResolvedValue({ totalCoins: 0, updatedSuccessfully: 0, skipped: 0, errors: 0 })
    } as any;

    snapshotService = {
      captureSnapshots: jest.fn().mockResolvedValue(5),
      getCoinsNeedingBackfill: jest.fn().mockResolvedValue([]),
      backfillFromHistoricalData: jest.fn().mockResolvedValue(30)
    } as any;

    coinMarketData = {
      getCoinHistoricalData: jest.fn().mockResolvedValue([])
    } as any;

    tickerFetcher = {
      fetchAllTickersForExchange: jest.fn().mockResolvedValue([])
    } as any;

    geckoService = {
      client: {
        coins: {
          list: { get: mockCoinList }
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
      tickerFetcher as any,
      geckoService,
      { acquire: jest.fn().mockResolvedValue({ acquired: true, lockId: 'test' }), release: jest.fn() } as any,
      { isOpen: jest.fn().mockReturnValue(false), recordSuccess: jest.fn(), recordFailure: jest.fn() } as any,
      { recordFailure: jest.fn() } as any
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

    it('schedules coin-sync, coin-market-sync, and coin-metadata-sync jobs in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';

      await task.onModuleInit();

      expect(queue.add).toHaveBeenCalledTimes(3);
      expect(queue.add).toHaveBeenCalledWith(
        'coin-sync',
        expect.any(Object),
        expect.objectContaining({
          attempts: 3,
          repeat: { pattern: expect.any(String) }
        })
      );
      expect(queue.add).toHaveBeenCalledWith(
        'coin-market-sync',
        expect.any(Object),
        expect.objectContaining({ attempts: 3, repeat: { pattern: expect.any(String) } })
      );
      expect(queue.add).toHaveBeenCalledWith(
        'coin-metadata-sync',
        expect.any(Object),
        expect.objectContaining({ attempts: 3, repeat: { pattern: '0 2 1 * *' } })
      );
    });

    it('removes the legacy coin-detail repeatable job if still scheduled', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';
      queue.getRepeatableJobs.mockResolvedValue([{ name: 'coin-detail', pattern: '0 23 * * *', key: 'legacy-key' }]);

      await task.onModuleInit();

      expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('legacy-key');
    });

    it('skips scheduling if jobs already exist', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';
      queue.getRepeatableJobs.mockResolvedValue([
        { name: 'coin-sync', pattern: '0 0 * * 0' },
        { name: 'coin-market-sync', pattern: '0 23 * * *' },
        { name: 'coin-metadata-sync', pattern: '0 2 1 * *' }
      ]);

      await task.onModuleInit();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does not schedule again on second call (jobScheduled guard)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';

      await task.onModuleInit();
      await task.onModuleInit();

      expect(queue.add).toHaveBeenCalledTimes(3); // only first call
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

    it('routes coin-market-sync to handleCoinMarketSync', async () => {
      const expected = { totalCoins: 5, updatedSuccessfully: 4, errors: 1, snapshotsCaptured: 5 };
      const spy = jest.spyOn(task, 'handleCoinMarketSync').mockResolvedValue(expected);
      const job = { name: 'coin-market-sync', id: 'job-2' } as Job;

      const result = await task.process(job);

      expect(spy).toHaveBeenCalledWith(job);
      expect(result).toEqual(expected);
    });

    it('routes legacy coin-detail job name to handleCoinMarketSync', async () => {
      const expected = { totalCoins: 5, updatedSuccessfully: 4, errors: 1, snapshotsCaptured: 5 };
      const spy = jest.spyOn(task, 'handleCoinMarketSync').mockResolvedValue(expected);
      const job = { name: 'coin-detail', id: 'job-legacy' } as Job;

      const result = await task.process(job);

      expect(spy).toHaveBeenCalledWith(job);
      expect(result).toEqual(expected);
    });

    it('routes coin-metadata-sync to handleCoinMetadataSync', async () => {
      const expected = { totalCoins: 10, updatedSuccessfully: 8, skipped: 2, errors: 0 };
      const spy = jest.spyOn(task, 'handleCoinMetadataSync').mockResolvedValue(expected);
      const job = { name: 'coin-metadata-sync', id: 'job-meta' } as Job;

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

      tickerFetcher.fetchAllTickersForExchange.mockResolvedValue([
        { coin_id: 'ethereum' },
        { coin_id: 'bitcoin' }
      ] as any);

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

      mockCoinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
        { id: 'litecoin', symbol: 'ltc', name: 'Litecoin' }
      ]);

      exchangeService.getExchanges.mockResolvedValue([{ slug: 'binance', name: 'Binance' }] as any);

      // Only bitcoin is in ticker pairs, litecoin is not
      tickerFetcher.fetchAllTickersForExchange.mockResolvedValue([{ coin_id: 'bitcoin' }] as any);

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

      tickerFetcher.fetchAllTickersForExchange.mockResolvedValue([
        { coin_id: 'bitcoin' },
        { coin_id: 'relisted-coin' }
      ] as any);

      const job = makeJob();
      const result = await task.handleSyncCoins(job);

      expect(coinService.relistMany).toHaveBeenCalledWith(['id-relisted']);
      expect(listingEventService.recordBulkRelistings).toHaveBeenCalledWith(['id-relisted'], 'coin_sync');
      expect(result.relisted).toBe(1);
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

    it('delegates ticker fetching to the shared fetcher for each exchange', async () => {
      coinService.getCoins.mockResolvedValue([]);
      mockCoinList.mockResolvedValue([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }]);
      exchangeService.getExchanges.mockResolvedValue([
        { slug: 'binance', name: 'Binance' },
        { slug: 'coinbase', name: 'Coinbase' }
      ] as any);

      tickerFetcher.fetchAllTickersForExchange.mockResolvedValue([{ coin_id: 'bitcoin' }] as any);

      await task.handleSyncCoins(makeJob());

      expect(tickerFetcher.fetchAllTickersForExchange).toHaveBeenCalledWith('binance');
      expect(tickerFetcher.fetchAllTickersForExchange).toHaveBeenCalledWith('coinbase');
    });

    it('collects both base and target coin IDs from tickers', async () => {
      coinService.getCoins.mockResolvedValue([]);
      mockCoinList.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
        { id: 'tether', symbol: 'usdt', name: 'Tether' }
      ]);
      exchangeService.getExchanges.mockResolvedValue([{ slug: 'binance', name: 'Binance' }] as any);

      tickerFetcher.fetchAllTickersForExchange.mockResolvedValue([
        { coin_id: 'bitcoin', target_coin_id: 'tether' }
      ] as any);

      const result = await task.handleSyncCoins(makeJob());

      expect(coinService.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ slug: 'bitcoin' }),
          expect.objectContaining({ slug: 'tether' })
        ])
      );
      expect(result.added).toBe(2);
    });

    it('continues remaining exchanges when ticker fetch fails for one', async () => {
      coinService.getCoins.mockResolvedValue([]);
      mockCoinList.mockResolvedValue([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }]);
      exchangeService.getExchanges.mockResolvedValue([
        { slug: 'bad-exchange', name: 'BadExchange' },
        { slug: 'binance', name: 'Binance' }
      ] as any);

      tickerFetcher.fetchAllTickersForExchange
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce([{ coin_id: 'bitcoin' }] as any);

      const result = await task.handleSyncCoins(makeJob());

      expect(result.added).toBe(1); // bitcoin still added from second exchange
    });
  });

  describe('handleCoinMarketSync', () => {
    it('delegates to CoinDetailSyncService and returns its result with snapshots', async () => {
      const detailResult = { totalCoins: 5, updatedSuccessfully: 4, errors: 1 };
      coinDetailSync.syncCoinDetails.mockResolvedValue(detailResult);

      const job = { updateProgress: jest.fn(), name: 'coin-market-sync', id: 'detail-1' } as unknown as Job;
      const result = await task.handleCoinMarketSync(job);

      expect(coinDetailSync.syncCoinDetails).toHaveBeenCalledWith(expect.any(Function));
      expect(result).toEqual({ ...detailResult, snapshotsCaptured: 5 });
    });

    it('forwards progress to job.updateProgress', async () => {
      coinDetailSync.syncCoinDetails.mockImplementation(async (onProgress) => {
        await onProgress?.(50);
        return { totalCoins: 0, updatedSuccessfully: 0, errors: 0 };
      });

      const job = { updateProgress: jest.fn(), name: 'coin-market-sync', id: 'detail-2' } as unknown as Job;
      await task.handleCoinMarketSync(job);

      expect(job.updateProgress).toHaveBeenCalledWith(50);
    });

    it('rethrows errors from syncCoinDetails', async () => {
      const error = new Error('detail sync failed');
      coinDetailSync.syncCoinDetails.mockRejectedValue(error);

      const job = { updateProgress: jest.fn(), name: 'coin-market-sync', id: 'detail-3' } as unknown as Job;
      await expect(task.handleCoinMarketSync(job)).rejects.toThrow(error);
    });
  });

  describe('handleCoinMarketSync snapshots', () => {
    const freshCoins = [
      { id: 'id-btc', slug: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
      { id: 'id-eth', slug: 'ethereum', symbol: 'eth', name: 'Ethereum' }
    ];

    const makeJob = () =>
      ({
        updateProgress: jest.fn(),
        name: 'coin-market-sync',
        id: 'detail-snap-1'
      }) as unknown as Job;

    beforeEach(() => {
      coinService.getCoins.mockResolvedValue(freshCoins as any);
    });

    it('calls captureSnapshots after coin market sync', async () => {
      const result = await task.handleCoinMarketSync(makeJob());

      expect(snapshotService.captureSnapshots).toHaveBeenCalledWith(freshCoins);
      expect(result).toEqual(
        expect.objectContaining({
          snapshotsCaptured: 5
        })
      );
    });

    it('continues successfully even if snapshot capture fails', async () => {
      snapshotService.captureSnapshots.mockRejectedValue(new Error('DB connection lost'));

      const result = await task.handleCoinMarketSync(makeJob());

      expect(result).toEqual(
        expect.objectContaining({
          totalCoins: expect.any(Number),
          snapshotsCaptured: 0
        })
      );
    });

    it('backfills coins that need historical snapshots and marks them complete', async () => {
      snapshotService.getCoinsNeedingBackfill.mockResolvedValue(['id-btc']);
      const historicalData = [
        { timestamp: 1704067200000, price: 42000, volume: 10_000_000_000, marketCap: 800_000_000_000 }
      ];
      coinMarketData.getCoinHistoricalData.mockResolvedValue(historicalData as any);

      await task.handleCoinMarketSync(makeJob());

      expect(snapshotService.getCoinsNeedingBackfill).toHaveBeenCalled();
      expect(coinMarketData.getCoinHistoricalData).toHaveBeenCalledWith('id-btc');
      expect(snapshotService.backfillFromHistoricalData).toHaveBeenCalledWith('id-btc', historicalData);
      expect(coinService.markSnapshotBackfillComplete).toHaveBeenCalledWith('id-btc');
    });

    it('does not mark backfill complete when backfill throws', async () => {
      snapshotService.getCoinsNeedingBackfill.mockResolvedValue(['id-btc']);
      coinMarketData.getCoinHistoricalData.mockRejectedValue(new Error('CoinGecko down'));

      await task.handleCoinMarketSync(makeJob());

      expect(coinService.markSnapshotBackfillComplete).not.toHaveBeenCalled();
    });

    it('continues successfully even if backfill fails', async () => {
      snapshotService.getCoinsNeedingBackfill.mockRejectedValue(new Error('DB error'));

      const result = await task.handleCoinMarketSync(makeJob());

      expect(result).toEqual(
        expect.objectContaining({
          totalCoins: expect.any(Number),
          updatedSuccessfully: expect.any(Number)
        })
      );
    });

    it('skips backfill when no coins need it', async () => {
      snapshotService.getCoinsNeedingBackfill.mockResolvedValue([]);

      await task.handleCoinMarketSync(makeJob());

      expect(coinMarketData.getCoinHistoricalData).not.toHaveBeenCalled();
      expect(snapshotService.backfillFromHistoricalData).not.toHaveBeenCalled();
      expect(coinService.markSnapshotBackfillComplete).not.toHaveBeenCalled();
    });
  });

  describe('handleCoinMetadataSync', () => {
    it('delegates to CoinDetailSyncService.syncCoinMetadata and returns its result', async () => {
      const metadataResult = { totalCoins: 10, updatedSuccessfully: 8, skipped: 1, errors: 1 };
      coinDetailSync.syncCoinMetadata.mockResolvedValue(metadataResult);

      const job = { updateProgress: jest.fn(), name: 'coin-metadata-sync', id: 'meta-1' } as unknown as Job;
      const result = await task.handleCoinMetadataSync(job);

      expect(coinDetailSync.syncCoinMetadata).toHaveBeenCalledWith(expect.any(Function));
      expect(result).toEqual(metadataResult);
    });

    it('rethrows errors from syncCoinMetadata', async () => {
      const error = new Error('metadata sync failed');
      coinDetailSync.syncCoinMetadata.mockRejectedValue(error);

      const job = { updateProgress: jest.fn(), name: 'coin-metadata-sync', id: 'meta-2' } as unknown as Job;
      await expect(task.handleCoinMetadataSync(job)).rejects.toThrow(error);
    });
  });
});
