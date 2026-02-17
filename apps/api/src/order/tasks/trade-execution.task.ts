import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { AlgorithmActivationService } from '../../algorithm/services/algorithm-activation.service';
import { TradeExecutionService, TradeSignal } from '../services/trade-execution.service';

/**
 * TradeExecutionTask
 *
 * BullMQ processor for automated trade execution based on algorithm signals.
 * Runs every 5 minutes to check active algorithms and execute trades.
 */
@Processor('trade-execution')
@Injectable()
export class TradeExecutionTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TradeExecutionTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('trade-execution') private readonly tradeExecutionQueue: Queue,
    private readonly tradeExecutionService: TradeExecutionService,
    private readonly algorithmActivationService: AlgorithmActivationService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * Schedules the repeatable job for trade execution
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_TRADE_EXECUTION === 'true') {
      this.logger.log('Trade execution jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleTradeExecutionJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for trade execution
   */
  private async scheduleTradeExecutionJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.tradeExecutionQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'execute-trades');

    if (existingJob) {
      this.logger.log(`Trade execution job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.tradeExecutionQueue.add(
      'execute-trades',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled trade execution job'
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

    this.logger.log('Trade execution job scheduled with 5-minute cron pattern');
  }

  /**
   * BullMQ worker process method that handles trade execution
   */
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === 'execute-trades') {
        return await this.handleExecuteTrades(job);
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
   * Handle trade execution for all active algorithm activations
   * @param job - The job object
   */
  private async handleExecuteTrades(job: Job) {
    try {
      await job.updateProgress(10);

      // Fetch all active algorithm activations
      const activeActivations = await this.algorithmActivationService.findAllActiveAlgorithms();

      this.logger.log(`Found ${activeActivations.length} active algorithm activations`);

      if (activeActivations.length === 0) {
        return {
          totalActivations: 0,
          successCount: 0,
          failCount: 0,
          timestamp: new Date().toISOString()
        };
      }

      await job.updateProgress(20);

      let successCount = 0;
      let failCount = 0;

      const totalActivations = activeActivations.length;
      let processedActivations = 0;

      // Process each activation
      for (const activation of activeActivations) {
        try {
          // Generate trade signal based on algorithm strategy
          // TODO: In production, this should call the actual algorithm strategy
          // For now, we'll skip execution to avoid creating real trades without proper signals
          const signal = await this.generateTradeSignal();

          if (signal) {
            // For BUY signals, check funds and attempt opportunity selling if needed
            // Note: generateTradeSignal() currently returns null (TODO placeholder),
            // so this code path won't execute until signal generation is implemented.
            if (signal.action === 'BUY') {
              try {
                await this.tradeExecutionService.executeTradeSignal(signal);
                this.logger.log(
                  `Successfully executed trade for activation ${activation.id} (${activation.algorithm.name})`
                );
                successCount++;
              } catch (buyError) {
                // If buy failed (potentially insufficient funds), attempt opportunity selling
                // This is structurally ready but depends on generateTradeSignal() being implemented
                this.logger.warn(
                  `BUY trade failed for activation ${activation.id}, ` +
                    `opportunity selling check would occur here: ${buyError.message}`
                );
                failCount++;
              }
            } else {
              // SELL signals execute directly
              await this.tradeExecutionService.executeTradeSignal(signal);
              this.logger.log(
                `Successfully executed trade for activation ${activation.id} (${activation.algorithm.name})`
              );
              successCount++;
            }
          } else {
            this.logger.debug(
              `No trade signal generated for activation ${activation.id} (${activation.algorithm.name})`
            );
          }
        } catch (error) {
          this.logger.error(`Failed to execute trade for activation ${activation.id}: ${error.message}`, error.stack);
          failCount++;
          // Continue with next activation even if one fails
        }

        processedActivations++;
        // Update progress as we process activations
        const progressPercentage = Math.floor(20 + (processedActivations / totalActivations) * 70);
        await job.updateProgress(progressPercentage);
      }

      await job.updateProgress(100);
      this.logger.log(
        `Completed trade execution for ${totalActivations} activations (${successCount} successful, ${failCount} failed)`
      );

      return {
        totalActivations,
        successCount,
        failCount,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Trade execution failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate a trade signal for an algorithm activation
   * This is a placeholder - in production, this should call the actual algorithm strategy
   * @returns TradeSignal or null if no trade should be executed
   */
  private async generateTradeSignal(): Promise<TradeSignal | null> {
    // TODO: Integrate with algorithm strategy execution
    // For now, return null to prevent automatic trade execution
    // This should be replaced with actual algorithm signal generation:
    // 1. Call algorithm strategy's analyze() method
    // 2. Check if strategy returns a BUY or SELL signal
    // 3. Calculate trade size based on allocation percentage
    // 4. Return trade signal object

    // Example implementation (commented out to prevent automatic trades):
    /*
    try {
      const strategyResult = await this.algorithmRegistry.executeAlgorithm(
        activation.algorithmId,
        context
      );

      if (strategyResult && strategyResult.action !== 'HOLD') {
        // Calculate portfolio value (simplified - should get from balance service)
        const portfolioValue = 10000; // TODO: Get actual portfolio value
        const tradeSize = this.tradeExecutionService.calculateTradeSize(activation, portfolioValue);

        // Get current market price to calculate quantity
        const ticker = await exchangeClient.fetchTicker(strategyResult.symbol);
        const quantity = tradeSize / ticker.last;

        return {
          algorithmActivationId: activation.id,
          userId: activation.userId,
          exchangeKeyId: activation.exchangeKeyId,
          action: strategyResult.action,
          symbol: strategyResult.symbol,
          quantity
        };
      }
    } catch (error) {
      this.logger.error(`Failed to generate trade signal: ${error.message}`);
    }
    */

    return null;
  }
}
