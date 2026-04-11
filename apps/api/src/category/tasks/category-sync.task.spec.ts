import { type Job } from 'bullmq';

import { CategorySyncTask } from './category-sync.task';

import { type CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { Category } from '../category.entity';
import { type CategoryService } from '../category.service';

const mockGetList = jest.fn();

describe('CategorySyncTask', () => {
  let task: CategorySyncTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let categoryService: jest.Mocked<Pick<CategoryService, 'getCategories' | 'createMany' | 'removeMany'>>;
  let geckoService: CoinGeckoClientService;

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();

    queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue(undefined)
    };

    categoryService = {
      getCategories: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue([]),
      removeMany: jest.fn().mockResolvedValue(undefined)
    } as any;

    geckoService = {
      client: {
        coins: { categories: { getList: mockGetList } }
      }
    } as unknown as CoinGeckoClientService;

    task = new CategorySyncTask(
      queue as any,
      categoryService as any,
      geckoService,
      {
        acquire: jest.fn().mockResolvedValue({ acquired: true, lockId: 'test' }),
        release: jest.fn()
      } as any,
      { recordFailure: jest.fn() } as any
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  const makeJob = () =>
    ({
      updateProgress: jest.fn(),
      name: 'category-sync',
      id: 'job-1'
    }) as unknown as Job;

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

    it('schedules category-sync job in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DISABLE_BACKGROUND_TASKS = 'false';

      await task.onModuleInit();

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'category-sync',
        expect.objectContaining({ description: expect.stringContaining('category-sync') }),
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
      queue.getRepeatableJobs.mockResolvedValue([{ name: 'category-sync', pattern: '0 0 * * 0' }]);

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
    it('routes category-sync to handleSyncCategories', async () => {
      const expected = { added: 0, removed: 0, total: 0 };
      const spy = jest.spyOn(task, 'handleSyncCategories').mockResolvedValue(expected);
      const job = { name: 'category-sync', id: 'job-1' } as Job;

      const result = await task.process(job);

      expect(spy).toHaveBeenCalledWith(job);
      expect(result).toEqual(expected);
    });

    it('rethrows errors from handler', async () => {
      const error = new Error('sync failed');
      jest.spyOn(task, 'handleSyncCategories').mockRejectedValue(error);
      const job = { name: 'category-sync', id: 'job-2' } as Job;

      await expect(task.process(job)).rejects.toThrow(error);
    });

    it('returns undefined for unknown job name', async () => {
      const job = { name: 'unknown', id: 'job-3' } as Job;

      const result = await task.process(job);

      expect(result).toBeUndefined();
    });
  });

  describe('handleSyncCategories', () => {
    it('adds new categories from API', async () => {
      mockGetList.mockResolvedValue([
        { category_id: 'defi', name: 'DeFi' },
        { category_id: 'nft', name: 'NFT' }
      ]);
      categoryService.getCategories.mockResolvedValue([]);
      categoryService.createMany.mockResolvedValue([
        new Category({ slug: 'defi', name: 'DeFi' }),
        new Category({ slug: 'nft', name: 'NFT' })
      ]);

      const result = await task.handleSyncCategories(makeJob());

      expect(categoryService.createMany).toHaveBeenCalledWith([
        { slug: 'defi', name: 'DeFi' },
        { slug: 'nft', name: 'NFT' }
      ]);
      expect(result).toEqual({ added: 2, removed: 0, total: 2 });
    });

    it('removes categories missing from API', async () => {
      mockGetList.mockResolvedValue([{ category_id: 'defi', name: 'DeFi' }]);
      categoryService.getCategories.mockResolvedValue([
        new Category({ id: 'uuid-1', slug: 'defi', name: 'DeFi' }),
        new Category({ id: 'uuid-2', slug: 'old-cat', name: 'Old Category' })
      ]);

      const result = await task.handleSyncCategories(makeJob());

      expect(categoryService.removeMany).toHaveBeenCalledWith(['uuid-2']);
      expect(result).toEqual({ added: 0, removed: 1, total: 1 });
    });

    it('handles add and remove in a single sync', async () => {
      mockGetList.mockResolvedValue([
        { category_id: 'defi', name: 'DeFi' },
        { category_id: 'gaming', name: 'Gaming' }
      ]);
      categoryService.getCategories.mockResolvedValue([
        new Category({ id: 'uuid-1', slug: 'defi', name: 'DeFi' }),
        new Category({ id: 'uuid-2', slug: 'old-cat', name: 'Old' })
      ]);
      categoryService.createMany.mockResolvedValue([new Category({ slug: 'gaming', name: 'Gaming' })]);

      const result = await task.handleSyncCategories(makeJob());

      expect(categoryService.createMany).toHaveBeenCalledWith([{ slug: 'gaming', name: 'Gaming' }]);
      expect(categoryService.removeMany).toHaveBeenCalledWith(['uuid-2']);
      expect(result).toEqual({ added: 1, removed: 1, total: 2 });
    });

    it('handles empty API response gracefully', async () => {
      mockGetList.mockResolvedValue([]);
      categoryService.getCategories.mockResolvedValue([]);

      const result = await task.handleSyncCategories(makeJob());

      expect(result).toEqual({ added: 0, removed: 0, total: 0 });
      expect(categoryService.createMany).not.toHaveBeenCalled();
      expect(categoryService.removeMany).not.toHaveBeenCalled();
    });

    it('removes all existing categories when API returns empty', async () => {
      mockGetList.mockResolvedValue([]);
      categoryService.getCategories.mockResolvedValue([new Category({ id: 'uuid-1', slug: 'defi', name: 'DeFi' })]);

      const result = await task.handleSyncCategories(makeJob());

      expect(categoryService.removeMany).toHaveBeenCalledWith(['uuid-1']);
      expect(result).toEqual({ added: 0, removed: 1, total: 0 });
    });

    it('skips create/remove when nothing changed', async () => {
      mockGetList.mockResolvedValue([{ category_id: 'defi', name: 'DeFi' }]);
      categoryService.getCategories.mockResolvedValue([new Category({ id: 'uuid-1', slug: 'defi', name: 'DeFi' })]);

      const result = await task.handleSyncCategories(makeJob());

      expect(categoryService.createMany).not.toHaveBeenCalled();
      expect(categoryService.removeMany).not.toHaveBeenCalled();
      expect(result).toEqual({ added: 0, removed: 0, total: 1 });
    });

    it('throws on invalid API response', async () => {
      mockGetList.mockResolvedValue(null);

      await expect(task.handleSyncCategories(makeJob())).rejects.toThrow('Invalid API response format');
    });

    it('propagates errors from API', async () => {
      mockGetList.mockRejectedValue(new Error('CoinGecko down'));

      await expect(task.handleSyncCategories(makeJob())).rejects.toThrow('CoinGecko down');
    });
  });
});
