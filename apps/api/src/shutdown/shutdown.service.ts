import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

import { Queue } from 'bullmq';

/**
 * Graceful shutdown service that ensures BullMQ jobs complete
 * before the application terminates during deployment.
 *
 * This service:
 * 1. Pauses all queues so workers stop picking up new jobs
 * 2. Waits for active jobs to complete (with timeout)
 * 3. Logs shutdown progress for visibility
 */
@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private readonly JOB_DRAIN_TIMEOUT = 25000; // 25 seconds (leave 5s buffer for other cleanup)
  private readonly POLL_INTERVAL = 1000; // Check every second

  constructor(
    @InjectQueue('balance-queue') private readonly balanceQueue: Queue,
    @InjectQueue('backtest-queue') private readonly backtestQueue: Queue,
    @InjectQueue('category-queue') private readonly categoryQueue: Queue,
    @InjectQueue('coin-queue') private readonly coinQueue: Queue,
    @InjectQueue('drift-detection-queue') private readonly driftDetectionQueue: Queue,
    @InjectQueue('exchange-queue') private readonly exchangeQueue: Queue,
    @InjectQueue('ohlc-queue') private readonly ohlcQueue: Queue,
    @InjectQueue('order-queue') private readonly orderQueue: Queue,
    @InjectQueue('performance-ranking') private readonly performanceRankingQueue: Queue,
    @InjectQueue('portfolio-queue') private readonly portfolioQueue: Queue,
    @InjectQueue('price-queue') private readonly priceQueue: Queue,
    @InjectQueue('regime-check-queue') private readonly regimeCheckQueue: Queue,
    @InjectQueue('strategy-evaluation-queue') private readonly strategyEvaluationQueue: Queue,
    @InjectQueue('ticker-pairs-queue') private readonly tickerPairsQueue: Queue,
    @InjectQueue('trade-execution') private readonly tradeExecutionQueue: Queue,
    @InjectQueue('user-queue') private readonly userQueue: Queue,
    @InjectQueue('optimization') private readonly optimizationQueue: Queue
  ) {}

  private get queues(): { name: string; queue: Queue }[] {
    return [
      { name: 'balance-queue', queue: this.balanceQueue },
      { name: 'backtest-queue', queue: this.backtestQueue },
      { name: 'category-queue', queue: this.categoryQueue },
      { name: 'coin-queue', queue: this.coinQueue },
      { name: 'drift-detection-queue', queue: this.driftDetectionQueue },
      { name: 'exchange-queue', queue: this.exchangeQueue },
      { name: 'ohlc-queue', queue: this.ohlcQueue },
      { name: 'order-queue', queue: this.orderQueue },
      { name: 'performance-ranking', queue: this.performanceRankingQueue },
      { name: 'portfolio-queue', queue: this.portfolioQueue },
      { name: 'price-queue', queue: this.priceQueue },
      { name: 'regime-check-queue', queue: this.regimeCheckQueue },
      { name: 'strategy-evaluation-queue', queue: this.strategyEvaluationQueue },
      { name: 'ticker-pairs-queue', queue: this.tickerPairsQueue },
      { name: 'trade-execution', queue: this.tradeExecutionQueue },
      { name: 'user-queue', queue: this.userQueue },
      { name: 'optimization', queue: this.optimizationQueue }
    ];
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutdown signal received: ${signal || 'unknown'}. Starting graceful job shutdown...`);

    // Step 1: Pause all queues to stop workers from picking up new jobs
    await this.pauseAllQueues();

    // Step 2: Wait for active jobs to complete (with timeout)
    await this.waitForActiveJobs();

    this.logger.log('Graceful shutdown complete. All queues drained or timeout reached.');
  }

  /**
   * Pause all queues so workers stop picking up new jobs.
   * Existing jobs in progress will continue until completion.
   */
  private async pauseAllQueues(): Promise<void> {
    this.logger.log('Pausing all BullMQ queues...');

    const pausePromises = this.queues.map(async ({ name, queue }) => {
      try {
        await queue.pause();
        this.logger.debug(`Paused queue: ${name}`);
      } catch (error) {
        this.logger.warn(`Failed to pause queue ${name}: ${error.message}`);
      }
    });

    await Promise.allSettled(pausePromises);
    this.logger.log('All queues paused. Workers will not pick up new jobs.');
  }

  /**
   * Wait for all active jobs across all queues to complete.
   * Uses polling with a timeout to prevent hanging.
   */
  private async waitForActiveJobs(): Promise<void> {
    const startTime = Date.now();
    let iteration = 0;

    while (Date.now() - startTime < this.JOB_DRAIN_TIMEOUT) {
      const activeJobCounts = await this.getActiveJobCounts();
      const totalActive = Object.values(activeJobCounts).reduce((sum, count) => sum + count, 0);

      if (totalActive === 0) {
        this.logger.log('All active jobs completed.');
        return;
      }

      // Log progress every 5 seconds
      if (iteration % 5 === 0) {
        const activeQueues = Object.entries(activeJobCounts)
          .filter(([, count]) => count > 0)
          .map(([name, count]) => `${name}: ${count}`)
          .join(', ');

        this.logger.log(`Waiting for ${totalActive} active job(s): ${activeQueues}`);
      }

      await this.sleep(this.POLL_INTERVAL);
      iteration++;
    }

    // Timeout reached - log remaining jobs
    const finalCounts = await this.getActiveJobCounts();
    const remaining = Object.entries(finalCounts)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name}: ${count}`)
      .join(', ');

    if (remaining) {
      this.logger.warn(`Shutdown timeout reached. Remaining active jobs: ${remaining}`);
    }
  }

  /**
   * Get the count of active jobs for each queue.
   * Uses parallel execution to minimize latency during shutdown.
   */
  private async getActiveJobCounts(): Promise<Record<string, number>> {
    const results = await Promise.all(
      this.queues.map(async ({ name, queue }) => {
        try {
          const count = await queue.getActiveCount();
          return { name, count };
        } catch (error) {
          this.logger.warn(`Failed to get active count for ${name}: ${error.message}`);
          return { name, count: 0 };
        }
      })
    );

    return results.reduce(
      (counts, { name, count }) => {
        counts[name] = count;
        return counts;
      },
      {} as Record<string, number>
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
