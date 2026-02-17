import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { BacktestCheckpointState, DEFAULT_CHECKPOINT_CONFIG } from './backtest-checkpoint.interface';
import { BacktestEngine } from './backtest-engine.service';
import { BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import { backtestConfig } from './backtest.config';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';
import { CoinResolverService } from './coin-resolver.service';
import { MarketDataSet } from './market-data-set.entity';

import { MetricsService } from '../../metrics/metrics.service';
import { toErrorInfo } from '../../shared/error.util';

const BACKTEST_QUEUE_NAMES = backtestConfig();

@Injectable()
@Processor(BACKTEST_QUEUE_NAMES.historicalQueue, {
  lockDuration: 7_200_000,
  stalledInterval: 7_200_000,
  maxStalledCount: 1
})
export class BacktestProcessor extends WorkerHost {
  private readonly logger = new Logger(BacktestProcessor.name);

  constructor(
    private readonly backtestEngine: BacktestEngine,
    private readonly coinResolver: CoinResolverService,
    private readonly backtestStream: BacktestStreamService,
    private readonly backtestResultService: BacktestResultService,
    private readonly metricsService: MetricsService,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(MarketDataSet) private readonly marketDataSetRepository: Repository<MarketDataSet>
  ) {
    super();
  }

  async process(job: Job<BacktestJobData>): Promise<void> {
    const { backtestId, userId, datasetId, deterministicSeed, algorithmId, mode } = job.data;
    this.logger.log(`Processing historical backtest ${backtestId} for user ${userId}`);

    const strategyName = algorithmId ?? 'unknown';
    const endTimer = this.metricsService.startBacktestTimer(strategyName);

    try {
      const backtest = await this.backtestRepository.findOne({
        where: { id: backtestId },
        relations: ['algorithm', 'marketDataSet', 'user']
      });

      if (!backtest) {
        throw new Error(`Backtest ${backtestId} not found`);
      }

      if (backtest.status !== BacktestStatus.PENDING) {
        this.logger.warn(`Backtest ${backtestId} is not pending. Current status: ${backtest.status}`);
        return;
      }

      // Type guard: ensure this processor only handles HISTORICAL backtests
      if (mode !== BacktestType.HISTORICAL) {
        this.logger.error(`BacktestProcessor received wrong type: ${mode}, expected HISTORICAL`);
        await this.backtestResultService.markFailed(
          backtestId,
          `System error: BacktestType.${mode} incorrectly routed to historical processor.`
        );
        return;
      }

      const dataset =
        backtest.marketDataSet ?? (await this.marketDataSetRepository.findOne({ where: { id: datasetId } }));
      if (!dataset) {
        throw new Error(`Market dataset ${datasetId} not found`);
      }

      // Check for existing checkpoint to resume from
      let resumeFrom: BacktestCheckpointState | undefined;
      if (backtest.checkpointState) {
        this.logger.log(
          `Found checkpoint at index ${backtest.checkpointState.lastProcessedIndex} for backtest ${backtestId}`
        );

        // Record checkpoint resume metric
        this.metricsService.recordCheckpointResumed(strategyName);

        // Clean up any orphaned results that may exist beyond the checkpoint
        const { deleted } = await this.backtestResultService.cleanupOrphanedResults(
          backtestId,
          backtest.checkpointState.persistedCounts
        );

        if (deleted.trades || deleted.signals || deleted.fills || deleted.snapshots) {
          this.backtestStream.publishLog(
            backtest.id,
            'warn',
            `Cleaned up ${deleted.trades + deleted.signals + deleted.fills + deleted.snapshots} orphaned records from previous run`
          );
        }

        resumeFrom = backtest.checkpointState;
      }

      backtest.status = BacktestStatus.RUNNING;
      await this.backtestRepository.save(backtest);

      // Record backtest started and increment active count
      this.metricsService.recordBacktestStarted(mode ?? 'historical', strategyName, !!resumeFrom);
      this.metricsService.incrementActiveBacktests(mode ?? 'historical');

      await this.backtestStream.publishStatus(backtest.id, 'running', undefined, {
        mode,
        resuming: !!resumeFrom,
        resumeIndex: resumeFrom?.lastProcessedIndex
      });

      const { coins, warnings } = await this.coinResolver.resolveCoins(dataset);

      // Merge warnings from coin resolution with existing backtest warnings
      if (warnings.length) {
        backtest.warningFlags = [...(backtest.warningFlags ?? []), ...warnings];
        await this.backtestRepository.save(backtest);
        for (const warning of warnings) {
          this.backtestStream.publishLog(backtest.id, 'warn', `Warning: ${warning}`);
        }
      }

      // Define checkpoint callback for incremental persistence
      const onCheckpoint = async (
        state: BacktestCheckpointState,
        results: {
          trades: any[];
          signals: any[];
          simulatedFills: any[];
          snapshots: any[];
        },
        totalTimestamps: number
      ) => {
        // Persist the incremental results first
        await this.backtestResultService.persistIncremental(backtest, results);

        // Then save the checkpoint state with accurate total count from engine
        await this.backtestResultService.saveCheckpoint(
          backtestId,
          state,
          state.lastProcessedIndex + 1,
          totalTimestamps
        );

        // Record checkpoint saved metric
        this.metricsService.recordCheckpointSaved(strategyName);

        // Publish progress update with accurate progress calculation
        const progress = ((state.lastProcessedIndex + 1) / totalTimestamps) * 100;
        await this.backtestStream.publishStatus(backtest.id, 'running', undefined, {
          progress: Math.round(progress),
          checkpointIndex: state.lastProcessedIndex,
          currentTimestamp: state.lastProcessedTimestamp
        });

        // Update progress metric
        this.metricsService.setCheckpointProgress(backtestId, strategyName, Math.round(progress));
      };

      let heartbeatCallCount = 0;
      const onHeartbeat = async (index: number, totalTimestamps: number) => {
        heartbeatCallCount++;

        // Check external FAILED status every ~90s (every 3rd heartbeat)
        if (heartbeatCallCount % 3 === 0) {
          const current = await this.backtestRepository.findOne({
            where: { id: backtestId },
            select: ['id', 'status']
          });
          if (current && current.status === BacktestStatus.FAILED) {
            throw new Error('Backtest was externally marked as FAILED — aborting execution');
          }
        }

        await this.backtestRepository.update(backtestId, {
          lastCheckpointAt: new Date(),
          processedTimestampCount: index + 1,
          totalTimestampCount: totalTimestamps
        });
      };

      const results = await this.backtestEngine.executeHistoricalBacktest(backtest, coins, {
        dataset,
        deterministicSeed,
        telemetryEnabled: true,
        checkpointInterval: DEFAULT_CHECKPOINT_CONFIG.checkpointInterval,
        onCheckpoint,
        onHeartbeat,
        resumeFrom
      });

      // Clear checkpoint on successful completion
      await this.backtestResultService.clearCheckpoint(backtestId);

      // Clear progress metric on completion
      this.metricsService.clearCheckpointProgress(backtestId, strategyName);

      await this.backtestResultService.persistSuccess(backtest, results);
      this.metricsService.recordBacktestCompleted(strategyName, 'success');

      // Record final metrics distribution
      this.metricsService.recordBacktestFinalMetrics(strategyName, {
        totalReturn: results.finalMetrics.totalReturn,
        sharpeRatio: results.finalMetrics.sharpeRatio,
        maxDrawdown: results.finalMetrics.maxDrawdown,
        tradeCount: results.finalMetrics.totalTrades
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Historical backtest ${backtestId} failed: ${err.message}`, err.stack);

      // Skip markFailed if already externally failed (e.g. by stale watchdog)
      const current = await this.backtestRepository.findOne({
        where: { id: backtestId },
        select: ['id', 'status']
      });
      if (!current || current.status !== BacktestStatus.FAILED) {
        await this.backtestResultService.markFailed(backtestId, err.message);
      }
      this.metricsService.recordBacktestCompleted(strategyName, 'failed');

      // Categorize error type for metrics
      const errorType = this.categorizeError(err);
      this.metricsService.recordBacktestError(strategyName, errorType);

      // Clear progress metric on failure
      this.metricsService.clearCheckpointProgress(backtestId, strategyName);
    } finally {
      // Decrement active backtest count
      this.metricsService.decrementActiveBacktests(mode ?? 'historical');
      endTimer();

      // Request V8 to perform a full GC and release memory back to the OS.
      // Requires --expose-gc flag (set in start:prod script).
      if (typeof global.gc === 'function') {
        global.gc();
      }
    }
  }

  /**
   * Categorize error for metrics tracking
   */
  private categorizeError(
    error: { message: string; stack?: string }
  ):
    | 'algorithm_not_found'
    | 'data_load_failed'
    | 'persistence_failed'
    | 'coin_resolution_failed'
    | 'quote_currency_failed'
    | 'execution_error'
    | 'unknown' {
    const message = error.message?.toLowerCase() ?? '';

    if (message.includes('algorithm') && (message.includes('not found') || message.includes('not registered'))) {
      return 'algorithm_not_found';
    }
    if (message.includes('price data') || message.includes('market data') || message.includes('no historical')) {
      return 'data_load_failed';
    }
    if (message.includes('persist') || message.includes('save') || message.includes('transaction')) {
      return 'persistence_failed';
    }
    if (
      message.includes('coin') &&
      (message.includes('resolution') || message.includes('not found') || message.includes('resolve'))
    ) {
      return 'coin_resolution_failed';
    }
    if (message.includes('quote currency') || message.includes('stablecoin')) {
      return 'quote_currency_failed';
    }
    if (message.includes('execution') || message.includes('simulate') || message.includes('trade')) {
      return 'execution_error';
    }

    return 'unknown';
  }
}
