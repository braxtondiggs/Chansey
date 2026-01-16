import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, FindOptionsOrder, ObjectLiteral, Repository } from 'typeorm';

import { BacktestCheckpointState, PersistedResultsCounts } from './backtest-checkpoint.interface';
import { BacktestStreamService } from './backtest-stream.service';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestStatus,
  BacktestTrade,
  SimulatedOrderFill
} from './backtest.entity';

import { MetricsService } from '../../metrics/metrics.service';

export interface BacktestFinalMetrics {
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
}

@Injectable()
export class BacktestResultService {
  private readonly logger = new Logger(BacktestResultService.name);

  constructor(
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(BacktestTrade) private readonly backtestTradeRepository: Repository<BacktestTrade>,
    @InjectRepository(BacktestSignal) private readonly backtestSignalRepository: Repository<BacktestSignal>,
    @InjectRepository(SimulatedOrderFill)
    private readonly simulatedFillRepository: Repository<SimulatedOrderFill>,
    @InjectRepository(BacktestPerformanceSnapshot)
    private readonly backtestSnapshotRepository: Repository<BacktestPerformanceSnapshot>,
    private readonly dataSource: DataSource,
    private readonly backtestStream: BacktestStreamService,
    @Optional() private readonly metricsService?: MetricsService
  ) {}

  async persistSuccess(
    backtest: Backtest,
    results: {
      trades: Partial<BacktestTrade>[];
      signals: Partial<BacktestSignal>[];
      simulatedFills: Partial<SimulatedOrderFill>[];
      snapshots: Partial<BacktestPerformanceSnapshot>[];
      finalMetrics: BacktestFinalMetrics;
    }
  ): Promise<void> {
    const endTimer = this.metricsService?.startPersistenceTimer('full');
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (results.signals?.length) {
        await queryRunner.manager.save(BacktestSignal, results.signals);
        this.metricsService?.recordRecordsPersisted('signals', results.signals.length);
      }

      if (results.simulatedFills?.length) {
        await queryRunner.manager.save(SimulatedOrderFill, results.simulatedFills);
        this.metricsService?.recordRecordsPersisted('fills', results.simulatedFills.length);
      }

      if (results.trades?.length) {
        await queryRunner.manager.save(BacktestTrade, results.trades);
        this.metricsService?.recordRecordsPersisted('trades', results.trades.length);
      }

      if (results.snapshots?.length) {
        await queryRunner.manager.save(BacktestPerformanceSnapshot, results.snapshots);
        this.metricsService?.recordRecordsPersisted('snapshots', results.snapshots.length);
      }

      Object.assign(backtest, {
        finalValue: results.finalMetrics.finalValue,
        totalReturn: results.finalMetrics.totalReturn,
        annualizedReturn: results.finalMetrics.annualizedReturn,
        sharpeRatio: results.finalMetrics.sharpeRatio,
        maxDrawdown: results.finalMetrics.maxDrawdown,
        totalTrades: results.finalMetrics.totalTrades,
        winningTrades: results.finalMetrics.winningTrades,
        winRate: results.finalMetrics.winRate,
        status: BacktestStatus.COMPLETED,
        completedAt: new Date()
      });

      await queryRunner.manager.save(Backtest, backtest);

      await queryRunner.commitTransaction();
      this.logger.log(`Backtest ${backtest.id} results persisted successfully`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to persist backtest ${backtest.id} results: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
      endTimer?.();
    }

    // Publish status AFTER transaction commits to ensure consistency
    await this.backtestStream.publishStatus(backtest.id, 'completed');
  }

  async markFailed(backtestId: string, errorMessage: string): Promise<void> {
    await this.backtestRepository.update(backtestId, {
      status: BacktestStatus.FAILED,
      errorMessage
    });

    await this.backtestStream.publishStatus(backtestId, 'failed', errorMessage);
  }

  async markCancelled(backtest: Backtest, reason?: string): Promise<void> {
    backtest.status = BacktestStatus.CANCELLED;
    await this.backtestRepository.save(backtest);
    await this.backtestStream.publishStatus(backtest.id, 'cancelled', reason);
  }

  /**
   * Persist results incrementally during checkpoint.
   * This is called periodically during backtest execution to save progress.
   */
  async persistIncremental(
    backtest: Backtest,
    results: {
      trades: Partial<BacktestTrade>[];
      signals: Partial<BacktestSignal>[];
      simulatedFills: Partial<SimulatedOrderFill>[];
      snapshots: Partial<BacktestPerformanceSnapshot>[];
    }
  ): Promise<void> {
    const endTimer = this.metricsService?.startPersistenceTimer('incremental');

    try {
      if (results.signals?.length) {
        await this.backtestSignalRepository.save(results.signals);
        this.metricsService?.recordRecordsPersisted('signals', results.signals.length);
      }

      if (results.simulatedFills?.length) {
        await this.simulatedFillRepository.save(results.simulatedFills);
        this.metricsService?.recordRecordsPersisted('fills', results.simulatedFills.length);
      }

      if (results.trades?.length) {
        await this.backtestTradeRepository.save(results.trades);
        this.metricsService?.recordRecordsPersisted('trades', results.trades.length);
      }

      if (results.snapshots?.length) {
        await this.backtestSnapshotRepository.save(results.snapshots);
        this.metricsService?.recordRecordsPersisted('snapshots', results.snapshots.length);
      }

      this.logger.debug(
        `Persisted incremental results for backtest ${backtest.id}: ` +
          `${results.trades?.length ?? 0} trades, ${results.signals?.length ?? 0} signals, ` +
          `${results.simulatedFills?.length ?? 0} fills, ${results.snapshots?.length ?? 0} snapshots`
      );
    } finally {
      endTimer?.();
    }
  }

  /**
   * Save checkpoint state to the database.
   * Updates the backtest entity with the current checkpoint and progress counts.
   */
  async saveCheckpoint(
    backtestId: string,
    checkpoint: BacktestCheckpointState,
    processedCount: number,
    totalCount: number
  ): Promise<void> {
    await this.backtestRepository.update(backtestId, {
      checkpointState: checkpoint,
      lastCheckpointAt: new Date(),
      processedTimestampCount: processedCount,
      totalTimestampCount: totalCount
    });

    this.logger.debug(
      `Saved checkpoint for backtest ${backtestId} at index ${checkpoint.lastProcessedIndex} (${processedCount}/${totalCount})`
    );
  }

  /**
   * Clear checkpoint state after successful completion.
   * This should be called when a backtest finishes normally.
   */
  async clearCheckpoint(backtestId: string): Promise<void> {
    await this.backtestRepository.update(backtestId, {
      checkpointState: null,
      lastCheckpointAt: null
    });

    this.logger.debug(`Cleared checkpoint for backtest ${backtestId}`);
  }

  /**
   * Generic helper to clean up orphaned entities for a specific repository.
   * Deletes the most recent entities that exceed the expected count.
   */
  private async cleanupOrphanedForEntity<T extends ObjectLiteral>(
    repository: Repository<T>,
    backtestId: string,
    expectedCount: number,
    order: FindOptionsOrder<T>
  ): Promise<number> {
    const currentCount = await repository.count({ where: { backtest: { id: backtestId } } as any });

    if (currentCount <= expectedCount) {
      return 0;
    }

    const excessCount = currentCount - expectedCount;
    const excessEntities = await repository.find({
      where: { backtest: { id: backtestId } } as any,
      order,
      take: excessCount
    });

    if (excessEntities.length > 0) {
      await repository.remove(excessEntities);
      return excessEntities.length;
    }

    return 0;
  }

  /**
   * Clean up orphaned results that exceed expected counts.
   * This is used when resuming from a checkpoint to remove any partially-written
   * results that may have been saved after the checkpoint was taken.
   */
  async cleanupOrphanedResults(
    backtestId: string,
    expectedCounts: PersistedResultsCounts
  ): Promise<{ deleted: { trades: number; signals: number; fills: number; snapshots: number } }> {
    // Clean up each entity type using the generic helper
    const [trades, signals, fills, snapshots] = await Promise.all([
      this.cleanupOrphanedForEntity(this.backtestTradeRepository, backtestId, expectedCounts.trades, {
        executedAt: 'DESC'
      }),
      this.cleanupOrphanedForEntity(this.backtestSignalRepository, backtestId, expectedCounts.signals, {
        timestamp: 'DESC'
      }),
      this.cleanupOrphanedForEntity(this.simulatedFillRepository, backtestId, expectedCounts.fills, {
        executionTimestamp: 'DESC'
      }),
      this.cleanupOrphanedForEntity(this.backtestSnapshotRepository, backtestId, expectedCounts.snapshots, {
        timestamp: 'DESC'
      })
    ]);

    const deleted = { trades, signals, fills, snapshots };

    if (deleted.trades || deleted.signals || deleted.fills || deleted.snapshots) {
      this.logger.warn(
        `Cleaned up orphaned results for backtest ${backtestId}: ` +
          `${deleted.trades} trades, ${deleted.signals} signals, ${deleted.fills} fills, ${deleted.snapshots} snapshots`
      );

      // Record metrics for orphan cleanup
      this.metricsService?.recordCheckpointOrphansCleaned('trades', deleted.trades);
      this.metricsService?.recordCheckpointOrphansCleaned('signals', deleted.signals);
      this.metricsService?.recordCheckpointOrphansCleaned('fills', deleted.fills);
      this.metricsService?.recordCheckpointOrphansCleaned('snapshots', deleted.snapshots);
    }

    return { deleted };
  }

  /**
   * Get the current counts of persisted results for a backtest.
   * Used for verification during resume operations.
   */
  async getPersistedCounts(backtestId: string): Promise<PersistedResultsCounts> {
    const [trades, signals, fills, snapshots] = await Promise.all([
      this.backtestTradeRepository.count({ where: { backtest: { id: backtestId } } }),
      this.backtestSignalRepository.count({ where: { backtest: { id: backtestId } } }),
      this.simulatedFillRepository.count({ where: { backtest: { id: backtestId } } }),
      this.backtestSnapshotRepository.count({ where: { backtest: { id: backtestId } } })
    ]);

    return { trades, signals, fills, snapshots };
  }
}
