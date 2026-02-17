import { HttpService } from '@nestjs/axios';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { AxiosError } from 'axios';
import { Job, Queue } from 'bullmq';
import { firstValueFrom, retry, timeout } from 'rxjs';

import { toErrorInfo } from '../../shared/error.util';
import { CategoryService } from '../category.service';

@Processor('category-queue')
@Injectable()
export class CategorySyncTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CategorySyncTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('category-queue') private readonly categoryQueue: Queue,
    private readonly category: CategoryService,
    private readonly http: HttpService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * This ensures the cron job is only scheduled once when the application starts
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Category sync jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleCronJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for category synchronization
   */
  private async scheduleCronJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.categoryQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'category-sync');

    if (existingJob) {
      this.logger.log(`Category sync job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.categoryQueue.add(
      'category-sync',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled category sync job'
      },
      {
        repeat: { pattern: CronExpression.EVERY_WEEK },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100, // keep the last 100 completed jobs
        removeOnFail: 50 // keep the last 50 failed jobs
      }
    );

    this.logger.log('Category sync job scheduled with weekly cron pattern');
  }

  // BullMQ: log job start, completion, and errors inside process/handler
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
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
    }
  }

  private async fetchCategories() {
    return firstValueFrom(
      this.http
        .get('https://api.coingecko.com/api/v3/coins/categories/list', {
          timeout: 10000
        })
        .pipe(timeout(12000), retry({ count: 3, delay: 1000 }))
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

      if (!apiResponse?.data || !Array.isArray(apiResponse.data)) {
        throw new Error('Invalid API response format');
      }

      const apiCategories = apiResponse.data;
      await job.updateProgress(50);

      const newCategories = apiCategories
        .map((c) => ({ slug: c.category_id, name: c.name }))
        .filter((category) => !existingCategories.find((existing) => existing.slug === category.slug));
      await job.updateProgress(70);

      const missingCategories = existingCategories
        .filter((existing) => !apiCategories.find((api) => api.category_id === existing.slug))
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
        total: apiCategories.length
      };
    } catch (e: unknown) {
      if (e instanceof AxiosError) {
        const errorDetails = {
          status: e.response?.status,
          statusText: e.response?.statusText,
          data: e.response?.data
        };
        this.logger.error(`Category sync failed: ${e.message}`, errorDetails);
      } else {
        const err = toErrorInfo(e);
        this.logger.error(`Category sync failed: ${err.message}`);
      }
      throw e;
    } finally {
      this.logger.log('Category Sync Complete');
    }
  }
}
