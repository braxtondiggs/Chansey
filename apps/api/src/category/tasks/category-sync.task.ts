import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import type { CategoryGetListResponse } from '@coingecko/coingecko-typescript/resources/coins/categories';
import { Job, Queue } from 'bullmq';

import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../../shared/distributed-lock.constants';
import { DistributedLockService } from '../../shared/distributed-lock.service';
import { toErrorInfo } from '../../shared/error.util';
import { withRateLimitRetryThrow } from '../../shared/retry.util';
import { CategoryService } from '../category.service';

// BullMQ auto-renews its internal worker lock every `lockDuration / 2` ms, so
// a short value here gives fast stall detection. Exclusivity is enforced by
// the distributed lock, not by this setting.
@Processor('category-queue', { lockDuration: 60_000, stalledInterval: 30_000 })
@Injectable()
export class CategorySyncTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CategorySyncTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('category-queue') private readonly categoryQueue: Queue,
    private readonly category: CategoryService,
    private readonly gecko: CoinGeckoClientService,
    private readonly lockService: DistributedLockService
  ) {
    super();
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Category sync jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleRepeatableJob('category-sync', CronExpression.EVERY_WEEK);
      this.jobScheduled = true;
    }
  }

  private async scheduleRepeatableJob(name: string, pattern: string): Promise<void> {
    const repeatedJobs = await this.categoryQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === name);

    if (existingJob) {
      this.logger.log(`${name} job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.categoryQueue.add(
      name,
      {
        timestamp: new Date().toISOString(),
        description: `Scheduled ${name} job`
      },
      {
        repeat: { pattern },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );

    this.logger.log(`${name} job scheduled with pattern: ${pattern}`);
  }

  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    const lock = await this.lockService.acquire({
      key: LOCK_KEYS.CATEGORY_SYNC,
      ttlMs: LOCK_DEFAULTS.CATEGORY_SYNC_TTL_MS
    });
    if (!lock.acquired) {
      this.logger.warn(`Could not acquire lock for ${job.name}, skipping`);
      return { skipped: true, reason: 'lock_not_acquired' };
    }

    try {
      if (job.name === 'category-sync') {
        const result = await this.handleSyncCategories(job);
        this.logger.log(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
        return result;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    } finally {
      await this.lockService.release(LOCK_KEYS.CATEGORY_SYNC, lock.token);
    }
  }

  private async fetchCategories(): Promise<CategoryGetListResponse[]> {
    return withRateLimitRetryThrow(
      // SDK types getList() as a single object, but the API returns an array
      async () => this.gecko.client.coins.categories.getList() as unknown as Promise<CategoryGetListResponse[]>,
      { operationName: 'fetchCategories' }
    );
  }

  async handleSyncCategories(job: Job) {
    try {
      this.logger.log('Starting Category Sync');
      await job.updateProgress(10);

      const [apiResponse, existingCategories] = await Promise.all([
        this.fetchCategories(),
        this.category.getCategories()
      ]);
      await job.updateProgress(30);

      if (!apiResponse || !Array.isArray(apiResponse)) {
        throw new Error('Invalid API response format');
      }

      await job.updateProgress(50);

      const existingSlugs = new Set(existingCategories.map((c) => c.slug));
      const validItems = apiResponse.filter((c): c is Required<CategoryGetListResponse> => !!c.category_id && !!c.name);
      // Build deletion set from ALL items with a category_id (independent of name)
      // so that items with a valid id but missing name aren't incorrectly deleted.
      const apiSlugs = new Set(apiResponse.filter((c) => !!c.category_id).map((c) => c.category_id as string));

      const newCategories = validItems
        .map((c) => ({ slug: c.category_id, name: c.name }))
        .filter((category) => !existingSlugs.has(category.slug));
      await job.updateProgress(70);

      const missingCategories = existingCategories
        .filter((existing) => !apiSlugs.has(existing.slug))
        .map((category) => category.id);
      await job.updateProgress(80);

      if (newCategories.length > 0) {
        await this.category.createMany(newCategories);
        this.logger.log(
          `Added ${newCategories.length} categories: ${newCategories.map(({ name }) => name).join(', ')}`
        );
      }

      if (missingCategories.length > 0) {
        await this.category.removeMany(missingCategories);
        this.logger.log(`Removed ${missingCategories.length} obsolete categories`);
      }
      await job.updateProgress(100);

      // Return summary for job completion callback
      return {
        added: newCategories.length,
        removed: missingCategories.length,
        total: validItems.length
      };
    } catch (e: unknown) {
      const err = toErrorInfo(e);
      this.logger.error(`Category sync failed: ${err.message}`);
      throw e;
    } finally {
      this.logger.log('Category Sync Complete');
    }
  }
}
