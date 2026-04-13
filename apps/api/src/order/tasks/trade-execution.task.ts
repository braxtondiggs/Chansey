import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { TradingStateService } from '../../admin/trading-state/trading-state.service';
import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../shared/error.util';
import { TradeOrchestratorService } from '../services/trade-orchestrator.service';

/**
 * TradeExecutionTask
 *
 * BullMQ processor for automated trade execution based on algorithm signals.
 * Runs every 5 minutes to check active algorithms and execute trades.
 *
 * This is a thin scheduling/routing layer — all orchestration logic lives
 * in TradeOrchestratorService and its dependencies.
 */
@Processor('trade-execution', { lockDuration: 120_000, stalledInterval: 30_000 })
@Injectable()
export class TradeExecutionTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TradeExecutionTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('trade-execution') private readonly tradeExecutionQueue: Queue,
    private readonly tradeOrchestrator: TradeOrchestratorService,
    private readonly tradingStateService: TradingStateService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_TRADE_EXECUTION === 'true') {
      this.logger.log('Trade execution jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleTradeExecutionJob();
      this.jobScheduled = true;
    }
  }

  private async scheduleTradeExecutionJob() {
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
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );

    this.logger.log('Trade execution job scheduled with 5-minute cron pattern');
  }

  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    if (!this.tradingStateService.isTradingEnabled()) {
      this.logger.warn('Trading is globally halted — skipping trade execution job');
      return { success: false, message: 'Trading globally halted' };
    }

    try {
      if (job.name === 'execute-trades') {
        return await this.tradeOrchestrator.executeTrades((pct) => job.updateProgress(pct));
      } else {
        this.logger.warn(`Unknown job type: ${job.name}`);
        return { success: false, message: `Unknown job type: ${job.name}` };
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    }
  }
}
