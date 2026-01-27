import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, EntityManager, EntityTarget, FindOptionsOrder, ObjectLiteral, Repository } from 'typeorm';

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
   *
   * Uses a transaction to ensure all-or-nothing persistence. If any save fails,
   * the entire batch is rolled back, preventing partial writes that could cause
   * data inconsistency when resuming from checkpoints.
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

      await queryRunner.commitTransaction();

      this.logger.debug(
        `Persisted incremental results for backtest ${backtest.id}: ` +
          `${results.trades?.length ?? 0} trades, ${results.signals?.length ?? 0} signals, ` +
          `${results.simulatedFills?.length ?? 0} fills, ${results.snapshots?.length ?? 0} snapshots`
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to persist incremental results for backtest ${backtest.id}: ${error.message}`,
        error.stack
      );
      throw error;
    } finally {
      await queryRunner.release();
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
   * Generic helper to clean up orphaned entities for a specific entity class.
   * Deletes the most recent entities that exceed the expected count.
   * Accepts EntityManager for transactional operation.
   */
  private async cleanupOrphanedForEntity<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    backtestId: string,
    expectedCount: number,
    order: FindOptionsOrder<T>
  ): Promise<number> {
    const repository = manager.getRepository(entityClass);
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
   *
   * Uses a transaction to ensure all-or-nothing cleanup for data integrity.
   */
  async cleanupOrphanedResults(
    backtestId: string,
    expectedCounts: PersistedResultsCounts
  ): Promise<{ deleted: { trades: number; signals: number; fills: number; snapshots: number } }> {
    // Use transaction to ensure atomicity - if any cleanup fails, all are rolled back
    const deleted = await this.dataSource.transaction(async (manager) => {
      // Clean up each entity type sequentially within the transaction
      const trades = await this.cleanupOrphanedForEntity(manager, BacktestTrade, backtestId, expectedCounts.trades, {
        executedAt: 'DESC'
      });
      const signals = await this.cleanupOrphanedForEntity(manager, BacktestSignal, backtestId, expectedCounts.signals, {
        timestamp: 'DESC'
      });
      const fills = await this.cleanupOrphanedForEntity(manager, SimulatedOrderFill, backtestId, expectedCounts.fills, {
        executionTimestamp: 'DESC'
      });
      const snapshots = await this.cleanupOrphanedForEntity(
        manager,
        BacktestPerformanceSnapshot,
        backtestId,
        expectedCounts.snapshots,
        { timestamp: 'DESC' }
      );

      return { trades, signals, fills, snapshots };
    });

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
