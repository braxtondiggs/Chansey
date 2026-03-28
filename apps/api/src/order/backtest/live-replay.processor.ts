import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { BacktestAbortedError } from './backtest-aborted.error';
import { BacktestCheckpointState } from './backtest-checkpoint.interface';
import { BacktestEngine } from './backtest-engine.service';
import { CheckpointResults, DEFAULT_LIVE_REPLAY_CHECKPOINT_INTERVAL, ReplaySpeed } from './backtest-pacing.interface';
import { BacktestPauseService } from './backtest-pause.service';
import { BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import { backtestConfig } from './backtest.config';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';
import { BacktestService } from './backtest.service';
import { CoinResolverService } from './coin-resolver.service';
import { MarketDataSet } from './market-data-set.entity';

import { MetricsService } from '../../metrics/metrics.service';
import { toErrorInfo } from '../../shared/error.util';
import { ShutdownSignalService } from '../../shutdown/shutdown-signal.service';
import { ExitConfig } from '../interfaces/exit-config.interface';

const BACKTEST_QUEUE_NAMES = backtestConfig();

@Injectable()
@Processor(BACKTEST_QUEUE_NAMES.replayQueue, {
  lockDuration: 7_200_000,
  stalledInterval: 300_000,
  maxStalledCount: 2
})
export class LiveReplayProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(LiveReplayProcessor.name);

  constructor(
    private readonly backtestEngine: BacktestEngine,
    private readonly coinResolver: CoinResolverService,
    private readonly backtestStream: BacktestStreamService,
    private readonly backtestResultService: BacktestResultService,
    private readonly backtestPauseService: BacktestPauseService,
    private readonly backtestService: BacktestService,
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
    private readonly shutdownSignal: ShutdownSignalService,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(MarketDataSet) private readonly marketDataSetRepository: Repository<MarketDataSet>
  ) {
    super();
  }

  onModuleInit(): void {
    const concurrency = this.configService.get<number>('backtest.replayConcurrency', 2);
    this.worker.concurrency = concurrency;
    this.logger.log(`Live replay worker concurrency set to ${concurrency}`);
  }

  async process(job: Job<BacktestJobData>): Promise<void> {
    const { backtestId, userId, datasetId, deterministicSeed, algorithmId, mode } = job.data;
    this.logger.log(`Processing live replay backtest ${backtestId} for user ${userId}`);

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

      // Type guard: ensure this processor only handles LIVE_REPLAY backtests
      if (backtest.type !== BacktestType.LIVE_REPLAY) {
        this.logger.error(`LiveReplayProcessor received wrong type: ${backtest.type}, expected LIVE_REPLAY`);
        await this.backtestResultService.markFailed(
          backtestId,
          `System error: BacktestType.${backtest.type} incorrectly routed to replay processor.`
        );
        return;
      }

      if (backtest.status !== BacktestStatus.PENDING) {
        this.logger.warn(`Backtest ${backtestId} is not pending. Current status: ${backtest.status}`);
        return;
      }

      const dataset =
        backtest.marketDataSet ?? (await this.marketDataSetRepository.findOne({ where: { id: datasetId } }));
      if (!dataset) {
        throw new Error(`Market dataset ${datasetId} not found`);
      }

      if (!dataset.replayCapable) {
        throw new Error('Dataset is not flagged as replay capable');
      }

      // Check if we're resuming from a checkpoint
      const isResuming = !!backtest.checkpointState;

      if (isResuming) {
        this.metricsService.recordCheckpointResumed(strategyName);
      }

      // Clean up any orphaned results that may have been partially written after the checkpoint
      // This ensures data consistency when resuming from a crash or unexpected termination
      if (isResuming && backtest.checkpointState?.persistedCounts) {
        this.logger.log(
          `Resuming from checkpoint at index ${backtest.checkpointState.lastProcessedIndex}, cleaning up orphans...`
        );
        const { deleted } = await this.backtestResultService.cleanupOrphanedResults(
          backtestId,
          backtest.checkpointState.persistedCounts
        );
        if (deleted.trades || deleted.signals || deleted.fills || deleted.snapshots) {
          this.logger.log(
            `Orphan cleanup complete: removed ${deleted.trades} trades, ${deleted.signals} signals, ${deleted.fills} fills, ${deleted.snapshots} snapshots`
          );
        }
      }

      backtest.status = BacktestStatus.RUNNING;
      // Initialize live replay state with configuration
      backtest.liveReplayState = {
        replaySpeed: this.getReplaySpeedFromConfig(backtest),
        isPaused: false
      };
      await this.backtestRepository.save(backtest);

      // Record backtest started and increment active count
      this.metricsService.recordBacktestStarted(mode ?? 'live_replay', strategyName, isResuming);
      this.metricsService.incrementActiveBacktests(mode ?? 'live_replay');

      // Clear any stale pause flag from previous runs
      await this.backtestPauseService.clearPauseFlag(backtestId);

      await this.backtestStream.publishStatus(backtest.id, 'running', undefined, {
        mode,
        isLiveReplay: true,
        isResuming,
        replaySpeed: backtest.liveReplayState.replaySpeed
      });

      const { coins, warnings } = await this.coinResolver.resolveCoins(dataset, {
        symbolFilter: backtest.configSnapshot?.coinSymbolFilter
      });

      // Merge warnings from coin resolution with existing backtest warnings
      if (warnings.length) {
        backtest.warningFlags = [...(backtest.warningFlags ?? []), ...warnings];
        await this.backtestRepository.save(backtest);
        for (const warning of warnings) {
          this.backtestStream.publishLog(backtest.id, 'warn', `Warning: ${warning}`);
        }
      }

      // Define pause check callback using the pause service
      const shouldPause = async (): Promise<boolean> => {
        return this.backtestPauseService.isPauseRequested(backtestId);
      };

      // Define callback for when backtest is paused
      const onPaused = async (checkpoint: BacktestCheckpointState): Promise<void> => {
        backtest.status = BacktestStatus.PAUSED;
        backtest.checkpointState = checkpoint;
        backtest.lastCheckpointAt = new Date();
        const pausedAt = new Date().toISOString();
        backtest.liveReplayState = {
          replaySpeed: backtest.liveReplayState?.replaySpeed ?? ReplaySpeed.FAST_5X,
          ...backtest.liveReplayState,
          isPaused: true,
          pausedAt,
          pauseReason: 'user_requested'
        };
        await this.backtestRepository.save(backtest);

        await this.backtestStream.publishStatus(backtest.id, 'paused', undefined, {
          checkpointIndex: checkpoint.lastProcessedIndex,
          pausedAt
        });

        this.logger.log(`Live replay ${backtestId} paused at checkpoint index ${checkpoint.lastProcessedIndex}`);
      };

      // Define checkpoint callback for incremental persistence
      const onCheckpoint = async (
        state: BacktestCheckpointState,
        results: CheckpointResults,
        totalTimestamps: number
      ): Promise<void> => {
        await this.backtestResultService.persistIncremental(backtest, results);
        await this.backtestResultService.saveCheckpoint(
          backtestId,
          state,
          state.lastProcessedIndex + 1,
          totalTimestamps
        );

        // Record checkpoint saved metric
        this.metricsService.recordCheckpointSaved(strategyName);
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

      // Execute live replay with pacing, pause support, and checkpoints
      const regimeConfig = backtest.configSnapshot?.regime;
      const results = await this.backtestEngine.executeLiveReplayBacktest(backtest, coins, {
        dataset,
        deterministicSeed,
        telemetryEnabled: true,
        replaySpeed: backtest.liveReplayState.replaySpeed,
        checkpointInterval: DEFAULT_LIVE_REPLAY_CHECKPOINT_INTERVAL,
        onCheckpoint,
        onHeartbeat,
        resumeFrom: backtest.checkpointState ?? undefined,
        shouldPause,
        onPaused,
        exitConfig: backtest.configSnapshot?.exitConfig as ExitConfig | undefined,
        enableRegimeGate: regimeConfig?.enableRegimeGate,
        enableRegimeScaledSizing: regimeConfig?.enableRegimeScaledSizing,
        riskLevel: regimeConfig?.riskLevel,
        abortSignal: this.shutdownSignal.signal
      });

      // Handle paused state (don't mark as completed)
      if (results.paused) {
        this.logger.log(`Live replay ${backtestId} paused, checkpoint saved`);
        // Clear the pause flag after successful pause
        await this.backtestPauseService.clearPauseFlag(backtestId);
        return;
      }

      // Clear pause flag after successful completion
      await this.backtestPauseService.clearPauseFlag(backtestId);

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
      // Graceful shutdown abort — leave as RUNNING for recovery on next boot
      if (error instanceof BacktestAbortedError) {
        this.logger.log(`Live replay backtest ${backtestId} aborted due to shutdown, checkpoint saved for recovery`);
        return;
      }

      const err = toErrorInfo(error);
      this.logger.error(`Live replay backtest ${backtestId} failed: ${err.message}`, err.stack);

      // Skip markFailed if already externally failed (e.g. by stale watchdog)
      const current = await this.backtestRepository.findOne({
        where: { id: backtestId },
        select: ['id', 'status']
      });
      if (!current || current.status !== BacktestStatus.FAILED) {
        await this.backtestResultService.markFailed(backtestId, err.message);
      }
      this.metricsService.recordBacktestCompleted(strategyName, 'failed');
    } finally {
      this.metricsService.decrementActiveBacktests(mode ?? 'live_replay');
      endTimer();

      // Release cached dataset reference so it can be garbage-collected
      this.backtestService.clearDatasetCache();

      // Request V8 to perform a full GC and release memory back to the OS.
      // Requires --expose-gc flag (set in start:prod script).
      if (typeof global.gc === 'function') {
        global.gc();
      }
    }
  }

  /**
   * Extract replay speed from backtest configuration.
   * Defaults to FAST_5X if not specified.
   */
  private getReplaySpeedFromConfig(backtest: Backtest): ReplaySpeed {
    const configSpeed = backtest.configSnapshot?.run?.replaySpeed;
    if (typeof configSpeed === 'number' && configSpeed in ReplaySpeed) {
      return configSpeed as ReplaySpeed;
    }
    if (typeof configSpeed === 'string' && configSpeed in ReplaySpeed) {
      return ReplaySpeed[configSpeed as keyof typeof ReplaySpeed];
    }
    return ReplaySpeed.FAST_5X;
  }
}
