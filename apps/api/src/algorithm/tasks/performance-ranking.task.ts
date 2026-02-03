import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { AlgorithmActivationService } from '../services/algorithm-activation.service';
import { AlgorithmPerformanceService } from '../services/algorithm-performance.service';

/**
 * PerformanceRankingTask
 *
 * BullMQ processor for calculating algorithm performance metrics and rankings.
 * Runs every 5 minutes to update performance data for all active algorithms.
 */
@Processor('performance-ranking')
@Injectable()
export class PerformanceRankingTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PerformanceRankingTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('performance-ranking') private readonly performanceRankingQueue: Queue,
    private readonly algorithmActivationService: AlgorithmActivationService,
    private readonly algorithmPerformanceService: AlgorithmPerformanceService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * Schedules the repeatable job for performance calculation
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_PERFORMANCE_RANKING === 'true') {
      this.logger.log('Performance ranking jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.schedulePerformanceRankingJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for performance ranking
   */
  private async schedulePerformanceRankingJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.performanceRankingQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'calculate-performance');

    if (existingJob) {
      this.logger.log(`Performance ranking job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.performanceRankingQueue.add(
      'calculate-performance',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled performance ranking job'
      },
      {
        repeat: {
          pattern: CronExpression.EVERY_5_MINUTES
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100, // keep the last 100 completed jobs
        removeOnFail: 50 // keep the last 50 failed jobs
      }
    );

    this.logger.log('Performance ranking job scheduled with 5-minute cron pattern');
  }

  /**
   * BullMQ worker process method that handles performance calculation
   */
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === 'calculate-performance') {
        return await this.handleCalculatePerformance(job);
      } else {
        this.logger.warn(`Unknown job type: ${job.name}`);
        return { success: false, message: `Unknown job type: ${job.name}` };
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle performance calculation and ranking for all active algorithm activations
   * @param job - The job object
   */
  private async handleCalculatePerformance(job: Job) {
    try {
      await job.updateProgress(10);

      // Fetch all active algorithm activations
      const activeActivations = await this.algorithmActivationService.findAllActiveAlgorithms();

      this.logger.log(`Found ${activeActivations.length} active algorithm activations`);

      if (activeActivations.length === 0) {
        return {
          totalActivations: 0,
          performanceCalculated: 0,
          usersRanked: 0,
          timestamp: new Date().toISOString()
        };
      }

      await job.updateProgress(20);

      let performanceCalculated = 0;
      const userIds = new Set<string>();

      const totalActivations = activeActivations.length;
      let processedActivations = 0;

      // Calculate performance for each activation
      for (const activation of activeActivations) {
        try {
          await this.algorithmPerformanceService.calculatePerformance(activation.id);
          performanceCalculated++;
          userIds.add(activation.userId);

          this.logger.debug(`Calculated performance for activation ${activation.id} (${activation.algorithm.name})`);
        } catch (error) {
          this.logger.error(
            `Failed to calculate performance for activation ${activation.id}: ${error.message}`,
            error.stack
          );
          // Continue with next activation even if one fails
        }

        processedActivations++;
        // Update progress as we process activations (20% to 70%)
        const progressPercentage = Math.floor(20 + (processedActivations / totalActivations) * 50);
        await job.updateProgress(progressPercentage);
      }

      await job.updateProgress(70);

      // Calculate rankings for each user
      let usersRanked = 0;
      const uniqueUserIds = Array.from(userIds);
      let processedUsers = 0;

      for (const userId of uniqueUserIds) {
        try {
          await this.algorithmPerformanceService.calculateRankings(userId);
          usersRanked++;
          this.logger.debug(`Calculated rankings for user ${userId}`);
        } catch (error) {
          this.logger.error(`Failed to calculate rankings for user ${userId}: ${error.message}`, error.stack);
          // Continue with next user even if one fails
        }

        processedUsers++;
        // Update progress as we rank users (70% to 100%)
        const progressPercentage = Math.floor(70 + (processedUsers / uniqueUserIds.length) * 30);
        await job.updateProgress(progressPercentage);
      }

      await job.updateProgress(100);
      this.logger.log(
        `Completed performance calculation: ${performanceCalculated} activations, ${usersRanked} users ranked`
      );

      return {
        totalActivations,
        performanceCalculated,
        usersRanked,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Performance calculation failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
