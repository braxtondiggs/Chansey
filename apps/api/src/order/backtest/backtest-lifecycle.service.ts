import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';

import { DEFAULT_CHECKPOINT_CONFIG } from './backtest-checkpoint.interface';
import { BacktestCoreRepository } from './backtest-core-repository.service';
import { wrapInternal } from './backtest-error.util';
import { BacktestPauseService } from './backtest-pause.service';
import { BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestProgressDto } from './dto/backtest.dto';

import { MetricsService } from '../../metrics/metrics.service';
import { toErrorInfo } from '../../shared/error.util';
import { forceRemoveJob } from '../../shared/queue.util';
import { User } from '../../users/users.entity';

@Injectable()
export class BacktestLifecycleService {
  private readonly logger = new Logger(BacktestLifecycleService.name);

  constructor(
    private readonly coreRepository: BacktestCoreRepository,
    private readonly backtestResultService: BacktestResultService,
    private readonly backtestPauseService: BacktestPauseService,
    private readonly backtestStream: BacktestStreamService,
    @Optional() private readonly metricsService?: MetricsService
  ) {}

  /**
   * Get backtest progress (for running backtests)
   */
  async getBacktestProgress(user: User, backtestId: string): Promise<BacktestProgressDto> {
    const backtest = await this.coreRepository.fetchWithStandardRelations(user, backtestId);

    // Calculate actual progress from checkpoint data if available
    const hasProgress = backtest.processedTimestampCount > 0 && backtest.totalTimestampCount > 0;
    const actualProgress = hasProgress
      ? Math.round((backtest.processedTimestampCount / backtest.totalTimestampCount) * 100)
      : 0;

    // Get current date from checkpoint if available
    const currentDate = backtest.checkpointState?.lastProcessedTimestamp
      ? new Date(backtest.checkpointState.lastProcessedTimestamp)
      : undefined;

    // Get trade count from checkpoint if available
    const tradesExecuted = backtest.checkpointState?.persistedCounts?.trades;

    switch (backtest.status) {
      case BacktestStatus.PENDING:
        return {
          progress: hasProgress ? actualProgress : 0,
          message: hasProgress
            ? `Backtest queued for processing (resuming from ${actualProgress}%)`
            : 'Backtest queued for processing'
        };
      case BacktestStatus.RUNNING:
        return {
          progress: hasProgress ? actualProgress : 50,
          message: hasProgress
            ? `Processing... ${backtest.processedTimestampCount.toLocaleString()} of ${backtest.totalTimestampCount.toLocaleString()} timestamps`
            : 'Backtest in progress...',
          currentDate,
          tradesExecuted
        };
      case BacktestStatus.PAUSED:
        return {
          progress: hasProgress ? actualProgress : 50,
          message: hasProgress
            ? `Paused at ${actualProgress}%. Resume when ready.`
            : 'Backtest paused. Resume when ready.',
          currentDate,
          tradesExecuted
        };
      case BacktestStatus.COMPLETED:
        return {
          progress: 100,
          message: 'Backtest completed successfully',
          tradesExecuted: backtest.totalTrades
        };
      case BacktestStatus.FAILED:
        return {
          progress: hasProgress ? actualProgress : 0,
          message: `Backtest failed: ${backtest.errorMessage || 'Unknown error'}`,
          currentDate,
          tradesExecuted
        };
      case BacktestStatus.CANCELLED:
        return {
          progress: hasProgress ? actualProgress : 0,
          message: hasProgress ? `Cancelled at ${actualProgress}%` : 'Backtest was cancelled',
          currentDate,
          tradesExecuted
        };
      default:
        return { progress: 0, message: 'Unknown status' };
    }
  }

  /**
   * Cancel a running backtest
   */
  async cancelBacktest(user: User, backtestId: string): Promise<void> {
    return wrapInternal(this.logger, `Failed to cancel backtest ${backtestId}`, async () => {
      const backtest = await this.coreRepository.fetchWithStandardRelations(user, backtestId);

      if (backtest.status !== BacktestStatus.RUNNING && backtest.status !== BacktestStatus.PENDING) {
        throw new BadRequestException('Can only cancel running or pending backtests');
      }

      const queue = this.coreRepository.getQueueForType(backtest.type);
      const job = await queue.getJob(backtest.id);
      if (job) {
        await job.remove();
      }

      await this.backtestResultService.markCancelled(backtest, 'User requested cancellation');

      // Record cancellation metric
      this.metricsService?.recordBacktestCancelled(backtest.algorithm?.name ?? 'unknown');

      try {
        await this.backtestStream.publishStatus(backtest.id, 'cancelled', undefined, {
          cancelledAt: new Date().toISOString(),
          reason: 'User requested cancellation'
        });
      } catch (streamError: unknown) {
        const err = toErrorInfo(streamError);
        this.logger.warn(`Failed to publish cancel status for backtest ${backtestId}: ${err.message}`);
      }
    });
  }

  /**
   * Request a running live replay backtest to pause.
   */
  async pauseBacktest(user: User, backtestId: string): Promise<void> {
    return wrapInternal(this.logger, `Failed to pause backtest ${backtestId}`, async () => {
      const backtest = await this.coreRepository.fetchWithStandardRelations(user, backtestId);

      if (backtest.status !== BacktestStatus.RUNNING) {
        throw new BadRequestException(`Can only pause running backtests. Current status: ${backtest.status}`);
      }

      if (backtest.type !== BacktestType.LIVE_REPLAY) {
        throw new BadRequestException(
          `Only live replay backtests support pause. This backtest type is: ${backtest.type}`
        );
      }

      await this.backtestPauseService.setPauseFlag(backtestId);

      try {
        await this.backtestStream.publishStatus(backtest.id, 'pause_requested', undefined, {
          requestedAt: new Date().toISOString()
        });
        await this.backtestStream.publishLog(
          backtest.id,
          'info',
          'Pause requested. Backtest will pause at the next checkpoint.'
        );
      } catch (streamError: unknown) {
        const err = toErrorInfo(streamError);
        this.logger.warn(`Failed to publish pause request status for backtest ${backtestId}: ${err.message}`);
      }

      this.logger.log(`Pause requested for backtest ${backtestId}`);
    });
  }

  async resumeBacktest(user: User, backtestId: string): Promise<Backtest> {
    return wrapInternal(this.logger, `Failed to resume backtest ${backtestId}`, async () => {
      const backtest = await this.coreRepository.fetchWithStandardRelations(user, backtestId);

      const resumableStatuses = [BacktestStatus.PAUSED, BacktestStatus.CANCELLED, BacktestStatus.FAILED];
      if (!resumableStatuses.includes(backtest.status)) {
        throw new BadRequestException(
          `Only paused, cancelled, or failed backtests can be resumed. Current status: ${backtest.status}`
        );
      }

      let hasValidCheckpoint = false;
      if (backtest.checkpointState && backtest.lastCheckpointAt) {
        const checkpointAge = Date.now() - new Date(backtest.lastCheckpointAt).getTime();

        if (checkpointAge > DEFAULT_CHECKPOINT_CONFIG.maxCheckpointAge) {
          this.logger.warn(
            `Clearing stale checkpoint for backtest ${backtestId} (age: ${Math.round(checkpointAge / 1000 / 60 / 60)}h)`
          );
          backtest.checkpointState = undefined;
          backtest.lastCheckpointAt = undefined;
          backtest.processedTimestampCount = 0;
        } else {
          hasValidCheckpoint = true;
          const progress = backtest.totalTimestampCount
            ? Math.round((backtest.processedTimestampCount / backtest.totalTimestampCount) * 100)
            : 0;
          this.logger.log(
            `Resuming backtest ${backtestId} from checkpoint at index ${backtest.checkpointState.lastProcessedIndex} (${progress}% complete)`
          );
        }
      }

      backtest.status = BacktestStatus.PENDING;
      await this.coreRepository.save(backtest);

      const payload = this.coreRepository.buildJobPayload(backtest, {
        userId: backtest.user.id,
        algorithmId: backtest.algorithm.id,
        datasetId: backtest.marketDataSet?.id || backtest.configSnapshot?.dataset?.id,
        deterministicSeed: backtest.deterministicSeed
      });
      const queue = this.coreRepository.getQueueForType(backtest.type);
      // Remove any stale job with the same ID to prevent BullMQ jobId collision after deployment
      await forceRemoveJob(queue, backtest.id, this.logger);
      await queue.add('execute-backtest', payload, {
        jobId: backtest.id,
        removeOnComplete: true,
        removeOnFail: 50
      });

      try {
        await this.backtestStream.publishStatus(backtest.id, 'queued', undefined, {
          resumed: true,
          hasCheckpoint: hasValidCheckpoint,
          checkpointIndex: hasValidCheckpoint ? backtest.checkpointState?.lastProcessedIndex : undefined
        });
      } catch (streamError: unknown) {
        const err = toErrorInfo(streamError);
        this.logger.warn(`Failed to publish resume status for backtest ${backtestId}: ${err.message}`);
      }

      return backtest;
    });
  }
}
