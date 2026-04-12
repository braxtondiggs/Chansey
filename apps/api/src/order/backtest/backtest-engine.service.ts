import { Injectable } from '@nestjs/common';

import { BacktestCheckpointState } from './backtest-checkpoint.interface';
import { LiveReplayExecuteOptions, LiveReplayExecuteResult } from './backtest-pacing.interface';
import { BacktestPerformanceSnapshot } from './backtest-performance-snapshot.entity';
import { BacktestFinalMetrics } from './backtest-result.service';
import { BacktestSignal } from './backtest-signal.entity';
import { BacktestTrade } from './backtest-trade.entity';
import { Backtest } from './backtest.entity';
import {
  BacktestLoopRunner,
  CheckpointService,
  ExecuteOptions,
  OptimizationBacktestConfig,
  OptimizationBacktestResult,
  OptimizationCoreService,
  PrecomputedWindowData
} from './shared';
import { SimulatedOrderFill } from './simulated-order-fill.entity';

import { Coin } from '../../coin/coin.entity';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';

@Injectable()
export class BacktestEngine {
  constructor(
    private readonly checkpointSvc: CheckpointService,
    private readonly optimizationCore: OptimizationCoreService,
    private readonly loopRunner: BacktestLoopRunner
  ) {}

  async executeHistoricalBacktest(
    backtest: Backtest,
    coins: Coin[],
    options: ExecuteOptions
  ): Promise<{
    trades: Partial<BacktestTrade>[];
    signals: Partial<BacktestSignal>[];
    simulatedFills: Partial<SimulatedOrderFill>[];
    snapshots: Partial<BacktestPerformanceSnapshot>[];
    finalMetrics: BacktestFinalMetrics;
  }> {
    return this.loopRunner.execute(backtest, coins, { ...options, mode: 'historical' }) as Promise<{
      trades: Partial<BacktestTrade>[];
      signals: Partial<BacktestSignal>[];
      simulatedFills: Partial<SimulatedOrderFill>[];
      snapshots: Partial<BacktestPerformanceSnapshot>[];
      finalMetrics: BacktestFinalMetrics;
    }>;
  }

  /**
   * Execute a live replay backtest with real-time pacing and pause/resume support.
   */
  async executeLiveReplayBacktest(
    backtest: Backtest,
    coins: Coin[],
    options: LiveReplayExecuteOptions
  ): Promise<LiveReplayExecuteResult> {
    return this.loopRunner.execute(backtest, coins, {
      ...options,
      mode: 'live-replay'
    }) as Promise<LiveReplayExecuteResult>;
  }

  validateCheckpoint(checkpoint: BacktestCheckpointState, timestamps: string[]): { valid: boolean; reason?: string } {
    return this.checkpointSvc.validateCheckpoint(checkpoint, timestamps);
  }

  /**
   * Execute a lightweight backtest for parameter optimization.
   * Delegates to OptimizationCoreService.
   */
  async executeOptimizationBacktest(
    config: OptimizationBacktestConfig,
    coins: Coin[]
  ): Promise<OptimizationBacktestResult> {
    return this.optimizationCore.executeOptimizationBacktest(config, coins);
  }

  /**
   * Execute an optimization backtest using pre-loaded candle data indexed by coin.
   * Delegates to OptimizationCoreService.
   */
  async executeOptimizationBacktestWithData(
    config: OptimizationBacktestConfig,
    coins: Coin[],
    preloadedCandlesByCoin: Map<string, OHLCCandle[]>
  ): Promise<OptimizationBacktestResult> {
    return this.optimizationCore.executeOptimizationBacktestWithData(config, coins, preloadedCandlesByCoin);
  }

  /**
   * Pre-compute all expensive per-window data once for a single date range.
   * Delegates to OptimizationCoreService.
   */
  precomputeWindowData(
    coins: Coin[],
    preloadedCandlesByCoin: Map<string, OHLCCandle[]>,
    startDate: Date,
    endDate: Date
  ): PrecomputedWindowData {
    return this.optimizationCore.precomputeWindowData(coins, preloadedCandlesByCoin, startDate, endDate);
  }

  /**
   * Fast-path optimization backtest using pre-computed window data.
   * Delegates to OptimizationCoreService.
   */
  async runOptimizationBacktestWithPrecomputed(
    config: OptimizationBacktestConfig,
    coins: Coin[],
    precomputed: PrecomputedWindowData
  ): Promise<OptimizationBacktestResult> {
    return this.optimizationCore.runOptimizationBacktestWithPrecomputed(config, coins, precomputed);
  }
}
