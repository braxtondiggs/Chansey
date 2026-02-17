import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { Queue } from 'bullmq';

import { toErrorInfo } from '../../shared/error.util';

interface QueueStats {
  waiting: number;
  failed: number;
}

/**
 * Health indicator that monitors BullMQ queue health.
 * Tracks waiting and failed jobs across critical queues.
 * Fails if total failed jobs exceed threshold.
 */
@Injectable()
export class BullMQHealthIndicator {
  private readonly logger = new Logger(BullMQHealthIndicator.name);
  private readonly FAILED_JOBS_THRESHOLD = 100;
  private readonly TIMEOUT_MS = 5000;

  /**
   * Wrap a promise with a timeout to prevent indefinite hangs
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('BullMQ health check timeout')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
  }

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @InjectQueue('order-queue') private readonly orderQueue: Queue,
    @InjectQueue('coin-queue') private readonly coinQueue: Queue,
    @InjectQueue('price-queue') private readonly priceQueue: Queue,
    @InjectQueue('strategy-evaluation-queue') private readonly strategyEvaluationQueue: Queue,
    @InjectQueue('regime-check-queue') private readonly regimeCheckQueue: Queue
  ) {}

  /**
   * Check BullMQ queues health
   * Fails if total failed jobs exceed 100
   * Uses timeout to prevent indefinite hangs on Redis issues
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const queues = [
        { name: 'order-queue', queue: this.orderQueue },
        { name: 'coin-queue', queue: this.coinQueue },
        { name: 'price-queue', queue: this.priceQueue },
        { name: 'strategy-evaluation-queue', queue: this.strategyEvaluationQueue },
        { name: 'regime-check-queue', queue: this.regimeCheckQueue }
      ];

      // Check queues in parallel with timeout to avoid indefinite hangs
      const checkPromises = queues.map(async ({ name, queue }) => {
        const counts = await this.withTimeout(queue.getJobCounts('waiting', 'failed'), this.TIMEOUT_MS);
        return { name, counts };
      });

      const results = await Promise.all(checkPromises);

      const queueStats: Record<string, QueueStats> = {};
      let totalFailed = 0;

      for (const { name, counts } of results) {
        queueStats[name] = {
          waiting: counts.waiting || 0,
          failed: counts.failed || 0
        };
        totalFailed += counts.failed || 0;
      }

      const result = {
        ...queueStats,
        totalFailed
      };

      // Fail if total failed jobs exceed threshold
      if (totalFailed > this.FAILED_JOBS_THRESHOLD) {
        return indicator.down({
          ...result,
          message: `Total failed jobs (${totalFailed}) exceeds threshold (${this.FAILED_JOBS_THRESHOLD})`
        });
      }

      return indicator.up(result);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`BullMQ health check failed: ${err.message}`);
      return indicator.down({ error: err.message });
    }
  }
}
