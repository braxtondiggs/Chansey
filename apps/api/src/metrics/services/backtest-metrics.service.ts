import { Injectable } from '@nestjs/common';

import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';

@Injectable()
export class BacktestMetricsService {
  constructor(
    @InjectMetric('chansey_backtests_completed_total')
    private readonly backtestsCompletedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_duration_seconds')
    private readonly backtestDuration: Histogram<string>,
    @InjectMetric('chansey_backtest_quote_currency_fallback_total')
    private readonly quoteCurrencyFallbackTotal: Counter<string>,

    // Lifecycle
    @InjectMetric('chansey_backtest_created_total')
    private readonly backtestCreatedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_started_total')
    private readonly backtestStartedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_cancelled_total')
    private readonly backtestCancelledTotal: Counter<string>,
    @InjectMetric('chansey_backtest_active_count')
    private readonly backtestActiveCount: Gauge<string>,

    // Data Loading
    @InjectMetric('chansey_backtest_data_load_duration_seconds')
    private readonly backtestDataLoadDuration: Histogram<string>,
    @InjectMetric('chansey_backtest_data_records_loaded_total')
    private readonly backtestDataRecordsLoaded: Counter<string>,

    // Trade Execution
    @InjectMetric('chansey_backtest_trades_simulated_total')
    private readonly backtestTradesSimulated: Counter<string>,
    @InjectMetric('chansey_backtest_slippage_bps')
    private readonly backtestSlippageBps: Histogram<string>,

    // Algorithm Execution
    @InjectMetric('chansey_backtest_algorithm_executions_total')
    private readonly backtestAlgorithmExecutions: Counter<string>,
    @InjectMetric('chansey_backtest_signals_generated_total')
    private readonly backtestSignalsGenerated: Counter<string>,

    // Result Persistence
    @InjectMetric('chansey_backtest_persistence_duration_seconds')
    private readonly backtestPersistenceDuration: Histogram<string>,
    @InjectMetric('chansey_backtest_records_persisted_total')
    private readonly backtestRecordsPersisted: Counter<string>,

    // Resolution
    @InjectMetric('chansey_backtest_coin_resolution_total')
    private readonly backtestCoinResolution: Counter<string>,
    @InjectMetric('chansey_backtest_instruments_resolved_total')
    private readonly backtestInstrumentsResolved: Counter<string>,

    // Errors
    @InjectMetric('chansey_backtest_errors_total')
    private readonly backtestErrors: Counter<string>,

    // Final Results
    @InjectMetric('chansey_backtest_total_return_percent')
    private readonly backtestTotalReturn: Histogram<string>,
    @InjectMetric('chansey_backtest_sharpe_ratio')
    private readonly backtestSharpeRatio: Histogram<string>,
    @InjectMetric('chansey_backtest_max_drawdown_percent')
    private readonly backtestMaxDrawdown: Histogram<string>,
    @InjectMetric('chansey_backtest_trade_count')
    private readonly backtestTradeCount: Histogram<string>,

    // Checkpoints
    @InjectMetric('chansey_backtest_checkpoints_saved_total')
    private readonly backtestCheckpointsSavedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_checkpoints_resumed_total')
    private readonly backtestCheckpointsResumedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_checkpoint_orphans_cleaned_total')
    private readonly backtestCheckpointOrphansCleanedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_checkpoint_progress_percent')
    private readonly backtestCheckpointProgress: Gauge<string>
  ) {}

  recordBacktestCompleted(strategy: string, status: 'success' | 'failed' | 'cancelled'): void {
    this.backtestsCompletedTotal.inc({ strategy, status });
  }

  startBacktestTimer(strategy: string): () => void {
    return this.backtestDuration.startTimer({ strategy });
  }

  recordQuoteCurrencyFallback(preferred: string, actual: string): void {
    this.quoteCurrencyFallbackTotal.inc({ preferred, actual });
  }

  recordBacktestCreated(type: string, strategy: string): void {
    this.backtestCreatedTotal.inc({ type, strategy });
  }

  recordBacktestStarted(type: string, strategy: string, resumed: boolean): void {
    this.backtestStartedTotal.inc({ type, strategy, resumed: String(resumed) });
  }

  recordBacktestCancelled(strategy: string): void {
    this.backtestCancelledTotal.inc({ strategy });
  }

  incrementActiveBacktests(type: string): void {
    this.backtestActiveCount.inc({ type });
  }

  decrementActiveBacktests(type: string): void {
    this.backtestActiveCount.dec({ type });
  }

  startDataLoadTimer(source: string): () => void {
    return this.backtestDataLoadDuration.startTimer({ source });
  }

  recordDataRecordsLoaded(source: string, count: number): void {
    this.backtestDataRecordsLoaded.inc({ source }, count);
  }

  recordTradeSimulated(
    strategy: string,
    type: 'buy' | 'sell',
    result: 'executed' | 'rejected_insufficient_funds' | 'rejected_no_position' | 'rejected_no_price'
  ): void {
    this.backtestTradesSimulated.inc({ strategy, type, result });
  }

  recordSlippage(strategy: string, type: 'buy' | 'sell', slippageBps: number): void {
    this.backtestSlippageBps.observe({ strategy, type }, slippageBps);
  }

  recordAlgorithmExecution(strategy: string, result: 'success' | 'error' | 'no_signals'): void {
    this.backtestAlgorithmExecutions.inc({ strategy, result });
  }

  recordSignalGenerated(strategy: string, action: 'buy' | 'sell' | 'hold'): void {
    this.backtestSignalsGenerated.inc({ strategy, action });
  }

  startPersistenceTimer(operation: 'full' | 'incremental' | 'checkpoint'): () => void {
    return this.backtestPersistenceDuration.startTimer({ operation });
  }

  recordRecordsPersisted(entityType: 'trades' | 'signals' | 'fills' | 'snapshots', count: number): void {
    if (count > 0) {
      this.backtestRecordsPersisted.inc({ entity_type: entityType }, count);
    }
  }

  recordCoinResolution(result: 'success' | 'partial' | 'failed'): void {
    this.backtestCoinResolution.inc({ result });
  }

  recordInstrumentsResolved(method: 'direct' | 'symbol_extraction' | 'fallback', count: number): void {
    if (count > 0) {
      this.backtestInstrumentsResolved.inc({ method }, count);
    }
  }

  recordBacktestError(
    strategy: string,
    errorType:
      | 'algorithm_not_found'
      | 'data_load_failed'
      | 'persistence_failed'
      | 'coin_resolution_failed'
      | 'quote_currency_failed'
      | 'execution_error'
      | 'unknown'
  ): void {
    this.backtestErrors.inc({ strategy, error_type: errorType });
  }

  recordBacktestFinalMetrics(
    strategy: string,
    metrics: {
      totalReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      tradeCount: number;
    }
  ): void {
    this.backtestTotalReturn.observe({ strategy }, metrics.totalReturn * 100);
    this.backtestSharpeRatio.observe({ strategy }, metrics.sharpeRatio);
    this.backtestMaxDrawdown.observe({ strategy }, metrics.maxDrawdown * 100);
    this.backtestTradeCount.observe({ strategy }, metrics.tradeCount);
  }

  recordCheckpointSaved(strategy: string): void {
    this.backtestCheckpointsSavedTotal.inc({ strategy });
  }

  recordCheckpointResumed(strategy: string): void {
    this.backtestCheckpointsResumedTotal.inc({ strategy });
  }

  recordCheckpointOrphansCleaned(entityType: 'trades' | 'signals' | 'fills' | 'snapshots', count: number): void {
    if (count > 0) {
      this.backtestCheckpointOrphansCleanedTotal.inc({ entity_type: entityType }, count);
    }
  }

  setCheckpointProgress(backtestId: string, strategy: string, progressPercent: number): void {
    this.backtestCheckpointProgress.set({ backtest_id: backtestId, strategy }, progressPercent);
  }

  clearCheckpointProgress(backtestId: string, strategy: string): void {
    this.backtestCheckpointProgress.set({ backtest_id: backtestId, strategy }, 0);
  }
}
