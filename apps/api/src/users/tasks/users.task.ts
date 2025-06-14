import { Processor, InjectQueue, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { UsersService } from '../users.service';

@Processor('user-queue')
@Injectable()
export class UsersTaskService extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(UsersTaskService.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('user-queue') private readonly userQueue: Queue,
    private readonly user: UsersService
  ) {
    super();
  }

  async onModuleInit() {
    if (!this.jobScheduled) {
      await this.scheduleCronJob();
      this.jobScheduled = true;
    }
  }

  private async scheduleCronJob() {
    const repeatedJobs = await this.userQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'user-portfolio-update');
    if (existingJob) {
      this.logger.log(`User portfolio update job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }
    await this.userQueue.add(
      'user-portfolio-update',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled user portfolio update job'
      },
      {
        repeat: { pattern: CronExpression.EVERY_WEEK },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );
    this.logger.log('User portfolio update job scheduled with weekly cron pattern');
  }

  // BullMQ: log job start, completion, and errors inside process/handler
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      if (job.name === 'user-portfolio-update') {
        const result = await this.updateUserPortfolio(job);
        this.logger.log(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
        return result;
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateUserPortfolio(job: Job) {
    try {
      this.logger.log('Starting User Portfolio Update');
      await job.updateProgress(10);
      const users = await this.user.findAll();
      await job.updateProgress(30);
      let updated = 0;
      for (const user of users) {
        if (user.risk) {
          await this.user.updatePortfolioByUserRisk(user);
          updated++;
          this.logger.debug(`Updated portfolio for user: ${user.id}`);
        }
      }
      await job.updateProgress(100);
      return { updated, total: users.length };
    } catch (error) {
      this.logger.error('Failed to update user portfolios:', error.stack);
      throw error;
    }
  }
}
