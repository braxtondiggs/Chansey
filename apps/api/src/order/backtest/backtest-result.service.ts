import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

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
    private readonly dataSource: DataSource,
    private readonly backtestStream: BacktestStreamService
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
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (results.signals?.length) {
        await queryRunner.manager.save(BacktestSignal, results.signals);
      }

      if (results.simulatedFills?.length) {
        await queryRunner.manager.save(SimulatedOrderFill, results.simulatedFills);
      }

      if (results.trades?.length) {
        await queryRunner.manager.save(BacktestTrade, results.trades);
      }

      if (results.snapshots?.length) {
        await queryRunner.manager.save(BacktestPerformanceSnapshot, results.snapshots);
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
    if (results.signals?.length) {
      await this.backtestSignalRepository.save(results.signals);
    }

    if (results.simulatedFills?.length) {
      await this.simulatedFillRepository.save(results.simulatedFills);
    }

    if (results.trades?.length) {
      await this.backtestTradeRepository.save(results.trades);
    }

    if (results.snapshots?.length) {
      await this.backtestSnapshotRepository.save(results.snapshots);
    }

    this.logger.debug(
      `Persisted incremental results for backtest ${backtest.id}: ` +
        `${results.trades?.length ?? 0} trades, ${results.signals?.length ?? 0} signals, ` +
        `${results.simulatedFills?.length ?? 0} fills, ${results.snapshots?.length ?? 0} snapshots`
    );
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
   * Clean up orphaned results that exceed expected counts.
   * This is used when resuming from a checkpoint to remove any partially-written
   * results that may have been saved after the checkpoint was taken.
   */
  async cleanupOrphanedResults(
    backtestId: string,
    expectedCounts: PersistedResultsCounts
  ): Promise<{ deleted: { trades: number; signals: number; fills: number; snapshots: number } }> {
    const deleted = { trades: 0, signals: 0, fills: 0, snapshots: 0 };

    // Get current counts
    const [tradesCount, signalsCount, fillsCount, snapshotsCount] = await Promise.all([
      this.backtestTradeRepository.count({ where: { backtest: { id: backtestId } } }),
      this.backtestSignalRepository.count({ where: { backtest: { id: backtestId } } }),
      this.simulatedFillRepository.count({ where: { backtest: { id: backtestId } } }),
      this.backtestSnapshotRepository.count({ where: { backtest: { id: backtestId } } })
    ]);

    // Delete excess trades (if any)
    if (tradesCount > expectedCounts.trades) {
      const excessTrades = await this.backtestTradeRepository.find({
        where: { backtest: { id: backtestId } },
        order: { executedAt: 'DESC' },
        take: tradesCount - expectedCounts.trades
      });
      if (excessTrades.length > 0) {
        await this.backtestTradeRepository.remove(excessTrades);
        deleted.trades = excessTrades.length;
      }
    }

    // Delete excess signals (if any)
    if (signalsCount > expectedCounts.signals) {
      const excessSignals = await this.backtestSignalRepository.find({
        where: { backtest: { id: backtestId } },
        order: { timestamp: 'DESC' },
        take: signalsCount - expectedCounts.signals
      });
      if (excessSignals.length > 0) {
        await this.backtestSignalRepository.remove(excessSignals);
        deleted.signals = excessSignals.length;
      }
    }

    // Delete excess fills (if any)
    if (fillsCount > expectedCounts.fills) {
      const excessFills = await this.simulatedFillRepository.find({
        where: { backtest: { id: backtestId } },
        order: { executionTimestamp: 'DESC' },
        take: fillsCount - expectedCounts.fills
      });
      if (excessFills.length > 0) {
        await this.simulatedFillRepository.remove(excessFills);
        deleted.fills = excessFills.length;
      }
    }

    // Delete excess snapshots (if any)
    if (snapshotsCount > expectedCounts.snapshots) {
      const excessSnapshots = await this.backtestSnapshotRepository.find({
        where: { backtest: { id: backtestId } },
        order: { timestamp: 'DESC' },
        take: snapshotsCount - expectedCounts.snapshots
      });
      if (excessSnapshots.length > 0) {
        await this.backtestSnapshotRepository.remove(excessSnapshots);
        deleted.snapshots = excessSnapshots.length;
      }
    }

    if (deleted.trades || deleted.signals || deleted.fills || deleted.snapshots) {
      this.logger.warn(
        `Cleaned up orphaned results for backtest ${backtestId}: ` +
          `${deleted.trades} trades, ${deleted.signals} signals, ${deleted.fills} fills, ${deleted.snapshots} snapshots`
      );
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
