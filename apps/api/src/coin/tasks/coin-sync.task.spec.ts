import { Job } from 'bullmq';

import { CoinDetailSyncService } from './coin-detail-sync.service';
import { CoinSyncTask } from './coin-sync.task';

import { ExchangeService } from '../../exchange/exchange.service';
import { CoinListingEventService } from '../coin-listing-event.service';
import { CoinService } from '../coin.service';

// Mock coingecko-api-v3
const mockCoinList = jest.fn();
const mockExchangeIdTickers = jest.fn();
jest.mock('coingecko-api-v3', () => ({
  CoinGeckoClient: jest.fn().mockImplementation(() => ({
    coinList: mockCoinList,
    exchangeIdTickers: mockExchangeIdTickers
  }))
}));

describe('CoinSyncTask', () => {
  let task: CoinSyncTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let coinService: jest.Mocked<
    Pick<CoinService, 'getCoins' | 'createMany' | 'update' | 'removeMany' | 'relistMany' | 'clearRank'>
  >;
  let exchangeService: jest.Mocked<Pick<ExchangeService, 'getExchanges'>>;
  let listingEventService: jest.Mocked<
    Pick<CoinListingEventService, 'recordBulkDelistings' | 'recordBulkRelistings'>
  >;
  let coinDetailSync: jest.Mocked<Pick<CoinDetailSyncService, 'syncCoinDetails'>>;

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

    task = new CoinSyncTask(
      queue as any,
      coinService as any,
      exchangeService as any,
      listingEventService as any,
      coinDetailSync as any
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
      const expected = { totalCoins: 5, updatedSuccessfully: 4, errors: 1 };
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
        { id: 'id-relisted', slug: 'relisted-coin', symbol: 'rls', name: 'RelistedCoin', delistedAt: new Date('2026-01-01') }
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

      expect(mockExchangeIdTickers).toHaveBeenCalledWith(expect.objectContaining({ id: 'gdax' }));
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
    it('delegates to CoinDetailSyncService and returns its result', async () => {
      const expected = { totalCoins: 5, updatedSuccessfully: 4, errors: 1 };
      coinDetailSync.syncCoinDetails.mockResolvedValue(expected);

      const job = { updateProgress: jest.fn(), name: 'coin-detail', id: 'detail-1' } as unknown as Job;
      const result = await task.handleCoinDetail(job);

      expect(coinDetailSync.syncCoinDetails).toHaveBeenCalledWith(expect.any(Function));
      expect(result).toEqual(expected);
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
});
