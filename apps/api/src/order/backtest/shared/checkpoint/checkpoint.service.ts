import { Injectable } from '@nestjs/common';

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
          grossProfit += pnl;
        } else if (pnl < 0) {
          grossLoss += Math.abs(pnl);
        }
      }
    }
    return { sells, winningSells, grossProfit, grossLoss };
  }

  /**
   * Build a checkpoint state object for persistence.
   * Includes all state needed to resume execution from this point.
   */
  buildCheckpointState(
    lastProcessedIndex: number,
    lastProcessedTimestamp: string,
    portfolio: Portfolio,
    peakValue: number,
    maxDrawdown: number,
    rngState: number,
    tradesCount: number,
    signalsCount: number,
    fillsCount: number,
    snapshotsCount: number,
    sellsCount: number,
    winningSellsCount: number,
    serializedThrottleState?: SerializableThrottleState,
    grossProfit = 0,
    grossLoss = 0,
    exitTrackerState?: SerializableExitTrackerState
  ): BacktestCheckpointState {
    // Convert Map-based positions to array format for JSON serialization
    const checkpointPortfolio: CheckpointPortfolio = {
      cashBalance: portfolio.cashBalance,
      positions: Array.from(portfolio.positions.entries()).map(([coinId, pos]) => ({
        coinId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        ...(pos.entryDate && { entryDate: pos.entryDate.toISOString() })
      }))
    };

    // Serialize throttle state to JSON for checksum inclusion (before computing checksum)
    const throttleStateJson = serializedThrottleState ? JSON.stringify(serializedThrottleState) : undefined;

    // Build checksum for data integrity verification using centralized helper
    const checksumData = this.buildChecksumData(
      lastProcessedIndex,
      lastProcessedTimestamp,
      portfolio.cashBalance,
      portfolio.positions.size,
      peakValue,
      maxDrawdown,
      rngState,
      throttleStateJson
    );
    const checksum = this.computeChecksum(checksumData);

    return {
      lastProcessedIndex,
      lastProcessedTimestamp,
      portfolio: checkpointPortfolio,
      peakValue,
      maxDrawdown,
      rngState,
      persistedCounts: {
        trades: tradesCount,
        signals: signalsCount,
        fills: fillsCount,
        snapshots: snapshotsCount,
        sells: sellsCount,
        winningSells: winningSellsCount,
        grossProfit,
        grossLoss
      },
      checksum,
      ...(serializedThrottleState && { throttleState: serializedThrottleState }),
      ...(exitTrackerState && { exitTrackerState })
    };
  }
}
