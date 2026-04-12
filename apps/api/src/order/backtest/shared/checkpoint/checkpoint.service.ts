import { Injectable } from '@nestjs/common';

import { Decimal } from 'decimal.js';

import { createHash } from 'crypto';

import { BacktestCheckpointState, CheckpointPortfolio } from '../../backtest-checkpoint.interface';
import { CheckpointResults } from '../../backtest-pacing.interface';
import { BacktestPerformanceSnapshot } from '../../backtest-performance-snapshot.entity';
import { BacktestSignal } from '../../backtest-signal.entity';
import { BacktestTrade, TradeType } from '../../backtest-trade.entity';
import { SeededRandom } from '../../seeded-random';
import { SimulatedOrderFill } from '../../simulated-order-fill.entity';
import { BacktestExitTracker, SerializableExitTrackerState } from '../exits';
import { MetricsAccumulator } from '../metrics-accumulator';
import { Portfolio } from '../portfolio';
import { SerializableThrottleState, ThrottleState } from '../throttle';

/**
 * Parameters for building an emergency or scheduled checkpoint.
 */
export interface EmergencyCheckpointParams {
  backtestId: string;
  onCheckpoint:
    | ((state: BacktestCheckpointState, results: CheckpointResults, count: number) => Promise<void>)
    | undefined;
  currentIndex: number;
  timestamp: Date;
  portfolio: Portfolio;
  peakValue: number;
  maxDrawdown: number;
  rng: SeededRandom;
  trades: Partial<BacktestTrade>[];
  signals: Partial<BacktestSignal>[];
  simulatedFills: Partial<SimulatedOrderFill>[];
  snapshots: Partial<BacktestPerformanceSnapshot>[];
  totalPersistedCounts: { trades: number; signals: number; fills: number; snapshots: number };
  lastCheckpointCounts: { trades: number; signals: number; fills: number; snapshots: number };
  metricsAcc: MetricsAccumulator;
  throttleState: ThrottleState;
  exitTracker: BacktestExitTracker | null | undefined;
  tradingTimestampCount: number;
}

/**
 * Options for building a checkpoint state object.
 */
export interface BuildCheckpointStateOptions {
  lastProcessedIndex: number;
  lastProcessedTimestamp: string;
  portfolio: Portfolio;
  peakValue: number;
  maxDrawdown: number;
  rngState: number;
  tradesCount: number;
  signalsCount: number;
  fillsCount: number;
  snapshotsCount: number;
  sellsCount: number;
  winningSellsCount: number;
  serializedThrottleState?: SerializableThrottleState;
  grossProfit?: number;
  grossLoss?: number;
  exitTrackerState?: SerializableExitTrackerState;
}

/**
 * Checkpoint Service
 *
 * Builds checkpoint state objects and checksums for backtest persistence.
 * Provides:
 * 1. Checksum computation for data integrity verification
 * 2. Sell trade counting for cumulative metrics at checkpoint time
 * 3. Full checkpoint state construction with serialized portfolio, RNG, and throttle state
 */
@Injectable()
export class CheckpointService {
  /**
   * Compute a truncated SHA-256 checksum for data integrity verification.
   */
  computeChecksum(data: string): string {
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Build checksum data string for checkpoint integrity verification.
   * Centralized to ensure consistency between checkpoint creation and validation.
   */
  buildChecksumData(
    lastProcessedIndex: number,
    lastProcessedTimestamp: string,
    cashBalance: number,
    positionCount: number,
    peakValue: number,
    maxDrawdown: number,
    rngState: number,
    throttleStateJson?: string
  ): string {
    return JSON.stringify({
      lastProcessedIndex,
      lastProcessedTimestamp,
      cashBalance,
      positionCount,
      peakValue,
      maxDrawdown,
      rngState,
      ...(throttleStateJson !== undefined && { throttleState: throttleStateJson })
    });
  }

  /**
   * Count sell trades and winning sells in an array of trades.
   * Used to persist cumulative sell counts at checkpoint time.
   */
  countSells(trades: Partial<BacktestTrade>[]): {
    sells: number;
    winningSells: number;
    grossProfit: number;
    grossLoss: number;
  } {
    let sells = 0,
      winningSells = 0,
      grossProfit = 0,
      grossLoss = 0;
    for (const t of trades) {
      if (t.type === TradeType.SELL) {
        sells++;
        const pnl = t.realizedPnL ?? 0;
        if (pnl > 0) {
          winningSells++;
          grossProfit = new Decimal(grossProfit).plus(pnl).toNumber();
        } else if (pnl < 0) {
          grossLoss = new Decimal(grossLoss).plus(new Decimal(pnl).abs()).toNumber();
        }
      }
    }
    return { sells, winningSells, grossProfit, grossLoss };
  }

  /**
   * Build a checkpoint state object for persistence.
   * Includes all state needed to resume execution from this point.
   */
  /**
   * Validate a checkpoint against the current timestamp array.
   * Checks index bounds, timestamp match, and checksum integrity.
   */
  validateCheckpoint(checkpoint: BacktestCheckpointState, timestamps: string[]): { valid: boolean; reason?: string } {
    if (checkpoint.lastProcessedIndex < 0 || checkpoint.lastProcessedIndex >= timestamps.length) {
      return {
        valid: false,
        reason: `Checkpoint index ${checkpoint.lastProcessedIndex} out of bounds (0-${timestamps.length - 1})`
      };
    }

    const expectedTimestamp = timestamps[checkpoint.lastProcessedIndex];
    if (checkpoint.lastProcessedTimestamp !== expectedTimestamp) {
      return {
        valid: false,
        reason: `Timestamp mismatch at index ${checkpoint.lastProcessedIndex}: expected ${expectedTimestamp}, got ${checkpoint.lastProcessedTimestamp}`
      };
    }

    const throttleStateJson = checkpoint.throttleState ? JSON.stringify(checkpoint.throttleState) : undefined;
    const checksumData = this.buildChecksumData(
      checkpoint.lastProcessedIndex,
      checkpoint.lastProcessedTimestamp,
      checkpoint.portfolio.cashBalance,
      checkpoint.portfolio.positions.length,
      checkpoint.peakValue,
      checkpoint.maxDrawdown,
      checkpoint.rngState,
      throttleStateJson
    );
    const expectedChecksum = this.computeChecksum(checksumData);

    if (checkpoint.checksum !== expectedChecksum) {
      return { valid: false, reason: 'Checkpoint checksum validation failed - data may be corrupted' };
    }

    return { valid: true };
  }

  /**
   * Build a checkpoint state object for persistence.
   * Includes all state needed to resume execution from this point.
   */
  buildCheckpointState(opts: BuildCheckpointStateOptions): BacktestCheckpointState {
    // Convert Map-based positions to array format for JSON serialization
    const checkpointPortfolio: CheckpointPortfolio = {
      cashBalance: opts.portfolio.cashBalance,
      positions: Array.from(opts.portfolio.positions.entries()).map(([coinId, pos]) => ({
        coinId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        ...(pos.entryDate && { entryDate: pos.entryDate.toISOString() })
      }))
    };

    // Serialize throttle state to JSON for checksum inclusion (before computing checksum)
    const throttleStateJson = opts.serializedThrottleState ? JSON.stringify(opts.serializedThrottleState) : undefined;

    // Build checksum for data integrity verification using centralized helper
    const checksumData = this.buildChecksumData(
      opts.lastProcessedIndex,
      opts.lastProcessedTimestamp,
      opts.portfolio.cashBalance,
      opts.portfolio.positions.size,
      opts.peakValue,
      opts.maxDrawdown,
      opts.rngState,
      throttleStateJson
    );
    const checksum = this.computeChecksum(checksumData);

    const grossProfit = opts.grossProfit ?? 0;
    const grossLoss = opts.grossLoss ?? 0;

    return {
      lastProcessedIndex: opts.lastProcessedIndex,
      lastProcessedTimestamp: opts.lastProcessedTimestamp,
      portfolio: checkpointPortfolio,
      peakValue: opts.peakValue,
      maxDrawdown: opts.maxDrawdown,
      rngState: opts.rngState,
      persistedCounts: {
        trades: opts.tradesCount,
        signals: opts.signalsCount,
        fills: opts.fillsCount,
        snapshots: opts.snapshotsCount,
        sells: opts.sellsCount,
        winningSells: opts.winningSellsCount,
        grossProfit,
        grossLoss
      },
      checksum,
      ...(opts.serializedThrottleState && { throttleState: opts.serializedThrottleState }),
      ...(opts.exitTrackerState && { exitTrackerState: opts.exitTrackerState })
    };
  }
}
