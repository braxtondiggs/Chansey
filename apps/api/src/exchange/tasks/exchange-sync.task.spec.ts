import { Job } from 'bullmq';

import { ExchangeSyncTask } from './exchange-sync.task';

import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { Exchange } from '../exchange.entity';
import { ExchangeService } from '../exchange.service';

const mockExchangesGet = jest.fn();

describe('ExchangeSyncTask', () => {
  let task: ExchangeSyncTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let exchangeService: jest.Mocked<Pick<ExchangeService, 'getExchanges' | 'createMany' | 'updateMany' | 'removeMany'>>;
  let geckoService: CoinGeckoClientService;

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    mockExchangesGet.mockReset();

    jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      fn();
      return 0 as any;
    });

    queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue(undefined)
    };

    exchangeService = {
      getExchanges: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue(undefined),
      removeMany: jest.fn().mockResolvedValue(undefined)
    } as any;

    geckoService = {
      client: {
        exchanges: { get: mockExchangesGet }
      }
    } as unknown as CoinGeckoClientService;

    task = new ExchangeSyncTask(queue as any, exchangeService as any, geckoService, {
      acquire: jest.fn().mockResolvedValue({ acquired: true, lockId: 'test' }),
      release: jest.fn()
    } as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  const makeJob = () =>
    ({
      updateProgress: jest.fn(),
      name: 'exchange-sync',
      id: 'job-1'
    }) as unknown as Job;

  const makeApiExchange = (overrides: Record<string, unknown> = {}) => ({
    id: 'binance',
    name: 'Binance',
    url: 'https://binance.com',
    image: 'https://binance.com/logo.png',
    country: 'Cayman Islands',
    year_established: 2017,
    trust_score: 10,
    trust_score_rank: 1,
    trade_volume_24h_btc: 500000,
    trade_volume_24h_btc_normalized: 400000,
    facebook_url: null,
    reddit_url: null,
    telegram_url: null,
    twitter_handle: 'binance',
    other_url_1: null,
    other_url_2: null,
    centralized: true,
    ...overrides
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

    it('schedules exchange-sync job in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';

      await task.onModuleInit();

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'exchange-sync',
        expect.objectContaining({ description: expect.stringContaining('exchange sync') }),
        expect.objectContaining({
          attempts: 3,
          repeat: { pattern: expect.any(String) },
          backoff: { type: 'exponential', delay: 5000 }
        })
      );
    });

    it('skips scheduling if job already exists', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';
      queue.getRepeatableJobs.mockResolvedValue([{ name: 'exchange-sync', pattern: '0 0 * * 0' }]);

      await task.onModuleInit();

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does not schedule again on second call (jobScheduled guard)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';

      await task.onModuleInit();
      await task.onModuleInit();

      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('process', () => {
    it('routes exchange-sync to handleSyncExchanges', async () => {
      const expected = { added: 0, updated: 0, removed: 0, total: 0 };
      const spy = jest.spyOn(task, 'handleSyncExchanges').mockResolvedValue(expected);
      const job = { name: 'exchange-sync', id: 'job-1' } as Job;

      const result = await task.process(job);

      expect(spy).toHaveBeenCalledWith(job);
      expect(result).toEqual(expected);
    });

    it('rethrows errors from handler', async () => {
      const error = new Error('sync failed');
      jest.spyOn(task, 'handleSyncExchanges').mockRejectedValue(error);
      const job = { name: 'exchange-sync', id: 'job-2' } as Job;

      await expect(task.process(job)).rejects.toThrow(error);
    });

    it('returns undefined for unknown job name', async () => {
      const job = { name: 'unknown', id: 'job-3' } as Job;

      const result = await task.process(job);

      expect(result).toBeUndefined();
    });
  });

  describe('handleSyncExchanges', () => {
    it('adds new exchanges from API', async () => {
      const apiExchange = makeApiExchange();
      mockExchangesGet.mockResolvedValueOnce([apiExchange]).mockResolvedValueOnce([]);
      exchangeService.getExchanges.mockResolvedValue([]);
      exchangeService.createMany.mockResolvedValue([new Exchange({ name: 'Binance', slug: 'binance' })]);

      const job = makeJob();
      const result = await task.handleSyncExchanges(job);

      expect(exchangeService.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ slug: 'binance', name: 'Binance' })])
      );
      expect(result).toEqual({ added: 1, updated: 0, removed: 0, total: 1 });
    });

    it('updates existing exchanges', async () => {
      const existing = new Exchange({ id: 'uuid-1', slug: 'binance', name: 'Binance' });
      exchangeService.getExchanges.mockResolvedValue([existing]);
      const apiExchange = makeApiExchange({ name: 'Binance Updated' });
      mockExchangesGet.mockResolvedValueOnce([apiExchange]).mockResolvedValueOnce([]);

      const result = await task.handleSyncExchanges(makeJob());

      expect(exchangeService.updateMany).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ slug: 'binance', name: 'Binance Updated' })])
      );
      expect(result).toEqual({ added: 0, updated: 1, removed: 0, total: 1 });
    });

    it('removes exchanges missing from API', async () => {
      const existing = new Exchange({ id: 'uuid-1', slug: 'old-exchange', name: 'Old Exchange' });
      exchangeService.getExchanges.mockResolvedValue([existing]);
      mockExchangesGet.mockResolvedValueOnce([]);

      const result = await task.handleSyncExchanges(makeJob());

      expect(exchangeService.removeMany).toHaveBeenCalledWith(['uuid-1']);
      expect(result).toEqual({ added: 0, updated: 0, removed: 1, total: 0 });
    });

    it('handles add, update, and remove in a single sync', async () => {
      const existingKept = new Exchange({ id: 'uuid-1', slug: 'binance', name: 'Binance' });
      const existingRemoved = new Exchange({ id: 'uuid-2', slug: 'old-exchange', name: 'Old' });
      exchangeService.getExchanges.mockResolvedValue([existingKept, existingRemoved]);

      const updatedExchange = makeApiExchange({ name: 'Binance V2' });
      const newExchange = makeApiExchange({ id: 'coinbase', name: 'Coinbase' });
      mockExchangesGet.mockResolvedValueOnce([updatedExchange, newExchange]).mockResolvedValueOnce([]);
      exchangeService.createMany.mockResolvedValue([new Exchange({ name: 'Coinbase', slug: 'coinbase' })]);

      const result = await task.handleSyncExchanges(makeJob());

      expect(result).toEqual({ added: 1, updated: 1, removed: 1, total: 2 });
    });

    it('deduplicates exchanges with same slug', async () => {
      const dup1 = makeApiExchange({ id: 'binance', name: 'Binance' });
      const dup2 = makeApiExchange({ id: 'binance', name: 'Binance Dup' });
      mockExchangesGet.mockResolvedValueOnce([dup1, dup2]).mockResolvedValueOnce([]);
      exchangeService.createMany.mockResolvedValue([new Exchange({ name: 'Binance', slug: 'binance' })]);

      const result = await task.handleSyncExchanges(makeJob());

      expect(result.total).toBe(1);
    });

    it('deduplicates exchanges with same name', async () => {
      const ex1 = makeApiExchange({ id: 'exchange-a', name: 'Same Name' });
      const ex2 = makeApiExchange({ id: 'exchange-b', name: 'Same Name' });
      mockExchangesGet.mockResolvedValueOnce([ex1, ex2]).mockResolvedValueOnce([]);
      exchangeService.createMany.mockResolvedValue([]);

      const result = await task.handleSyncExchanges(makeJob());

      // Second exchange should get renamed to "Same Name (exchange-b)"
      expect(result.total).toBe(2);
    });

    it('skips exchanges with missing ID', async () => {
      const noId = makeApiExchange({ id: '', name: 'No ID Exchange' });
      const valid = makeApiExchange({ id: 'valid', name: 'Valid' });
      mockExchangesGet.mockResolvedValueOnce([noId, valid]).mockResolvedValueOnce([]);
      exchangeService.createMany.mockResolvedValue([new Exchange({ name: 'Valid', slug: 'valid' })]);

      const result = await task.handleSyncExchanges(makeJob());

      expect(result.total).toBe(1);
    });

    it('handles empty API response', async () => {
      mockExchangesGet.mockResolvedValueOnce([]);

      const result = await task.handleSyncExchanges(makeJob());

      expect(result).toEqual({ added: 0, updated: 0, removed: 0, total: 0 });
      expect(exchangeService.createMany).not.toHaveBeenCalled();
      expect(exchangeService.updateMany).not.toHaveBeenCalled();
      expect(exchangeService.removeMany).not.toHaveBeenCalled();
    });

    it('paginates through multiple pages', async () => {
      const page1 = Array.from({ length: 250 }, (_, i) => makeApiExchange({ id: `ex-${i}`, name: `Exchange ${i}` }));
      const page2 = [makeApiExchange({ id: 'ex-250', name: 'Exchange 250' })];
      mockExchangesGet.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
      exchangeService.createMany.mockResolvedValue([]);

      const result = await task.handleSyncExchanges(makeJob());

      expect(mockExchangesGet).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(251);
    });

    it('propagates errors from handleSyncExchanges', async () => {
      mockExchangesGet.mockRejectedValue(new Error('CoinGecko down'));

      await expect(task.handleSyncExchanges(makeJob())).rejects.toThrow('CoinGecko down');
    });

    it('continues when createMany fails', async () => {
      const apiExchange = makeApiExchange();
      mockExchangesGet.mockResolvedValueOnce([apiExchange]).mockResolvedValueOnce([]);
      exchangeService.createMany.mockRejectedValue(new Error('DB constraint violation'));

      const result = await task.handleSyncExchanges(makeJob());

      expect(result.added).toBe(1);
    });

    it('continues when updateMany fails', async () => {
      const existing = new Exchange({ id: 'uuid-1', slug: 'binance', name: 'Binance' });
      exchangeService.getExchanges.mockResolvedValue([existing]);
      mockExchangesGet.mockResolvedValueOnce([makeApiExchange()]).mockResolvedValueOnce([]);
      exchangeService.updateMany.mockRejectedValue(new Error('DB error'));

      const result = await task.handleSyncExchanges(makeJob());

      expect(result.updated).toBe(1);
    });

    it('continues when removeMany fails', async () => {
      const existing = new Exchange({ id: 'uuid-1', slug: 'stale', name: 'Stale' });
      exchangeService.getExchanges.mockResolvedValue([existing]);
      mockExchangesGet.mockResolvedValueOnce([]);
      exchangeService.removeMany.mockRejectedValue(new Error('FK constraint'));

      const result = await task.handleSyncExchanges(makeJob());

      expect(exchangeService.removeMany).toHaveBeenCalledWith(['uuid-1']);
      expect(result.removed).toBe(1);
    });

    it('maps API fields to Exchange entity correctly', async () => {
      const apiExchange = makeApiExchange({
        id: 'test-ex',
        name: 'Test Exchange',
        country: 'US',
        year_established: 2020,
        trust_score: 8,
        trust_score_rank: 5,
        trade_volume_24h_btc: 1000,
        trade_volume_24h_btc_normalized: 900,
        facebook_url: 'https://fb.com/test',
        reddit_url: 'https://reddit.com/r/test',
        telegram_url: 'https://t.me/test',
        twitter_handle: 'testex',
        other_url_1: 'https://other1.com',
        other_url_2: 'https://other2.com',
        centralized: false
      });
      mockExchangesGet.mockResolvedValueOnce([apiExchange]).mockResolvedValueOnce([]);
      exchangeService.createMany.mockResolvedValue([new Exchange({ slug: 'test-ex' })]);

      await task.handleSyncExchanges(makeJob());

      const created = exchangeService.createMany.mock.calls[0][0][0];
      expect(created.slug).toBe('test-ex');
      expect(created.name).toBe('Test Exchange');
      expect(created.country).toBe('US');
      expect(created.yearEstablished).toBe(2020);
      expect(created.trustScore).toBe(8);
      expect(created.trustScoreRank).toBe(5);
      expect(created.tradeVolume24HBtc).toBe(1000);
      expect(created.tradeVolume24HNormalized).toBe(900);
      expect(created.facebook).toBe('https://fb.com/test');
      expect(created.reddit).toBe('https://reddit.com/r/test');
      expect(created.telegram).toBe('https://t.me/test');
      expect(created.twitter).toBe('testex');
      expect(created.otherUrl1).toBe('https://other1.com');
      expect(created.otherUrl2).toBe('https://other2.com');
      expect(created.centralized).toBe(false);
      expect(created.isScraped).toBe(true);
    });

    it('uses exchange ID as name when name is empty', async () => {
      const apiExchange = makeApiExchange({ id: 'no-name-ex', name: '' });
      mockExchangesGet.mockResolvedValueOnce([apiExchange]).mockResolvedValueOnce([]);
      exchangeService.createMany.mockResolvedValue([new Exchange({ slug: 'no-name-ex' })]);

      await task.handleSyncExchanges(makeJob());

      const created = exchangeService.createMany.mock.calls[0][0][0];
      expect(created.name).toBe('no-name-ex');
    });

    it('skips duplicate new exchanges with the same mapped name', async () => {
      const ex1 = makeApiExchange({ id: 'ex-a', name: 'Same Name' });
      const ex2 = makeApiExchange({ id: 'ex-b', name: 'Same Name' });
      mockExchangesGet.mockResolvedValueOnce([ex1, ex2]).mockResolvedValueOnce([]);
      exchangeService.createMany.mockResolvedValue([]);

      const result = await task.handleSyncExchanges(makeJob());

      // ex2 gets renamed to "Same Name (ex-b)" by dedup, but seenNewNames prevents duplicates
      // Both should be created since their names differ after dedup
      expect(result.added).toBe(2);
    });

    it('preserves existing entity fields when updating', async () => {
      const existing = new Exchange({
        id: 'uuid-1',
        slug: 'binance',
        name: 'Binance',
        supported: true,
        tickerPairsCount: 500
      });
      exchangeService.getExchanges.mockResolvedValue([existing]);
      mockExchangesGet.mockResolvedValueOnce([makeApiExchange()]).mockResolvedValueOnce([]);

      await task.handleSyncExchanges(makeJob());

      const updated = exchangeService.updateMany.mock.calls[0][0][0];
      expect(updated.id).toBe('uuid-1');
      expect(updated.supported).toBe(true);
      expect(updated.tickerPairsCount).toBe(500);
    });
  });
});
