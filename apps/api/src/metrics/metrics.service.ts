/**
 * Metrics Service
 *
 * Provides a convenient interface for recording Prometheus metrics.
 * Inject this service into any module that needs to record custom metrics.
 *
 * @example
 * ```typescript
 * constructor(private readonly metrics: MetricsService) {}
 *
 * async syncOrders() {
 *   const end = this.metrics.startOrderSyncTimer('binance');
 *   try {
 *     // ... sync orders
 *     this.metrics.recordOrdersSynced('binance', 'success', 100);
 *   } finally {
 *     end();
 *   }
 * }
 * ```
 */

import { Injectable } from '@nestjs/common';

import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';

@Injectable()
export class MetricsService {
  constructor(
    // HTTP Metrics
    @InjectMetric('chansey_http_request_duration_seconds')
    private readonly httpRequestDuration: Histogram<string>,
    @InjectMetric('chansey_http_requests_total')
    private readonly httpRequestsTotal: Counter<string>,
    @InjectMetric('chansey_http_connections_active')
    private readonly httpConnectionsActive: Gauge<string>,

    // Order Metrics
    @InjectMetric('chansey_orders_synced_total')
    private readonly ordersSyncedTotal: Counter<string>,
    @InjectMetric('chansey_orders_sync_errors_total')
    private readonly ordersSyncErrorsTotal: Counter<string>,
    @InjectMetric('chansey_order_sync_duration_seconds')
    private readonly orderSyncDuration: Histogram<string>,

    // Trade Metrics
    @InjectMetric('chansey_trades_executed_total')
    private readonly tradesExecutedTotal: Counter<string>,
    @InjectMetric('chansey_trade_execution_duration_seconds')
    private readonly tradeExecutionDuration: Histogram<string>,

    // Exchange Metrics
    @InjectMetric('chansey_exchange_connections')
    private readonly exchangeConnections: Gauge<string>,
    @InjectMetric('chansey_exchange_api_calls_total')
    private readonly exchangeApiCallsTotal: Counter<string>,
    @InjectMetric('chansey_exchange_api_latency_seconds')
    private readonly exchangeApiLatency: Histogram<string>,

    // Price Metrics
    @InjectMetric('chansey_price_updates_total')
    private readonly priceUpdatesTotal: Counter<string>,
    @InjectMetric('chansey_price_update_lag_seconds')
    private readonly priceUpdateLag: Gauge<string>,

    // Backtest Metrics
    @InjectMetric('chansey_backtests_completed_total')
    private readonly backtestsCompletedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_duration_seconds')
    private readonly backtestDuration: Histogram<string>,
    @InjectMetric('chansey_backtest_quote_currency_fallback_total')
    private readonly quoteCurrencyFallbackTotal: Counter<string>,

    // Backtest Lifecycle Metrics
    @InjectMetric('chansey_backtest_created_total')
    private readonly backtestCreatedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_started_total')
    private readonly backtestStartedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_cancelled_total')
    private readonly backtestCancelledTotal: Counter<string>,
    @InjectMetric('chansey_backtest_active_count')
    private readonly backtestActiveCount: Gauge<string>,

    // Backtest Data Loading Metrics
    @InjectMetric('chansey_backtest_data_load_duration_seconds')
    private readonly backtestDataLoadDuration: Histogram<string>,
    @InjectMetric('chansey_backtest_data_records_loaded_total')
    private readonly backtestDataRecordsLoaded: Counter<string>,

    // Backtest Trade Execution Metrics
    @InjectMetric('chansey_backtest_trades_simulated_total')
    private readonly backtestTradesSimulated: Counter<string>,
    @InjectMetric('chansey_backtest_slippage_bps')
    private readonly backtestSlippageBps: Histogram<string>,

    // Backtest Algorithm Execution Metrics
    @InjectMetric('chansey_backtest_algorithm_executions_total')
    private readonly backtestAlgorithmExecutions: Counter<string>,
    @InjectMetric('chansey_backtest_signals_generated_total')
    private readonly backtestSignalsGenerated: Counter<string>,

    // Backtest Result Persistence Metrics
    @InjectMetric('chansey_backtest_persistence_duration_seconds')
    private readonly backtestPersistenceDuration: Histogram<string>,
    @InjectMetric('chansey_backtest_records_persisted_total')
    private readonly backtestRecordsPersisted: Counter<string>,

    // Backtest Resolution Metrics
    @InjectMetric('chansey_backtest_coin_resolution_total')
    private readonly backtestCoinResolution: Counter<string>,
    @InjectMetric('chansey_backtest_instruments_resolved_total')
    private readonly backtestInstrumentsResolved: Counter<string>,

    // Backtest Error Metrics
    @InjectMetric('chansey_backtest_errors_total')
    private readonly backtestErrors: Counter<string>,

    // Backtest Final Results Metrics
    @InjectMetric('chansey_backtest_total_return_percent')
    private readonly backtestTotalReturn: Histogram<string>,
    @InjectMetric('chansey_backtest_sharpe_ratio')
    private readonly backtestSharpeRatio: Histogram<string>,
    @InjectMetric('chansey_backtest_max_drawdown_percent')
    private readonly backtestMaxDrawdown: Histogram<string>,
    @InjectMetric('chansey_backtest_trade_count')
    private readonly backtestTradeCount: Histogram<string>,

    // Backtest Checkpoint Metrics
    @InjectMetric('chansey_backtest_checkpoints_saved_total')
    private readonly backtestCheckpointsSavedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_checkpoints_resumed_total')
    private readonly backtestCheckpointsResumedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_checkpoint_orphans_cleaned_total')
    private readonly backtestCheckpointOrphansCleanedTotal: Counter<string>,
    @InjectMetric('chansey_backtest_checkpoint_progress_percent')
    private readonly backtestCheckpointProgress: Gauge<string>,

    // Queue Metrics
    @InjectMetric('chansey_queue_jobs_waiting')
    private readonly queueJobsWaiting: Gauge<string>,
    @InjectMetric('chansey_queue_jobs_active')
    private readonly queueJobsActive: Gauge<string>,
    @InjectMetric('chansey_queue_jobs_completed_total')
    private readonly queueJobsCompletedTotal: Counter<string>,
    @InjectMetric('chansey_queue_jobs_failed_total')
    private readonly queueJobsFailedTotal: Counter<string>,

    // Portfolio Metrics
    @InjectMetric('chansey_portfolio_total_value_usd')
    private readonly portfolioTotalValue: Gauge<string>,
    @InjectMetric('chansey_portfolio_assets_count')
    private readonly portfolioAssetsCount: Gauge<string>,

    // Strategy Metrics
    @InjectMetric('chansey_strategy_deployments_active')
    private readonly strategyDeploymentsActive: Gauge<string>,
    @InjectMetric('chansey_strategy_signals_total')
    private readonly strategySignalsTotal: Counter<string>,

    // Strategy Heartbeat Metrics
    @InjectMetric('chansey_strategy_heartbeat_age_seconds')
    private readonly strategyHeartbeatAge: Gauge<string>,
    @InjectMetric('chansey_strategy_heartbeat_total')
    private readonly strategyHeartbeatTotal: Counter<string>,
    @InjectMetric('chansey_strategy_heartbeat_failures')
    private readonly strategyHeartbeatFailures: Gauge<string>,
    @InjectMetric('chansey_strategy_health_score')
    private readonly strategyHealthScore: Gauge<string>
  ) {}

  // ===================
  // HTTP Metrics
  // ===================

  /**
   * Record HTTP request duration and increment counter
   */
  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestDuration.observe(labels, durationMs / 1000);
    this.httpRequestsTotal.inc(labels);
  }

  /**
   * Set active HTTP connections
   */
  setActiveConnections(count: number): void {
    this.httpConnectionsActive.set(count);
  }

  // ===================
  // Order Metrics
  // ===================

  /**
   * Record orders synced from exchange
   */
  recordOrdersSynced(exchange: string, status: 'success' | 'partial' | 'failed', count = 1): void {
    this.ordersSyncedTotal.inc({ exchange, status }, count);
  }

  /**
   * Record order sync error
   */
  recordOrderSyncError(exchange: string, errorType: string): void {
    this.ordersSyncErrorsTotal.inc({ exchange, error_type: errorType });
  }

  /**
   * Start order sync timer - returns function to call when done
   */
  startOrderSyncTimer(exchange: string): () => void {
    const end = this.orderSyncDuration.startTimer({ exchange });
    return end;
  }

  // ===================
  // Trade Metrics
  // ===================

  /**
   * Record trade execution
   */
  recordTradeExecuted(exchange: string, side: 'buy' | 'sell', symbol: string): void {
    this.tradesExecutedTotal.inc({ exchange, side, symbol });
  }

  /**
   * Start trade execution timer
   */
  startTradeExecutionTimer(exchange: string): () => void {
    return this.tradeExecutionDuration.startTimer({ exchange });
  }

  // ===================
  // Exchange Metrics
  // ===================

  /**
   * Set number of active exchange connections
   */
  setExchangeConnections(exchange: string, count: number): void {
    this.exchangeConnections.set({ exchange }, count);
  }

  /**
   * Record exchange API call
   */
  recordExchangeApiCall(exchange: string, endpoint: string, success: boolean): void {
    this.exchangeApiCallsTotal.inc({ exchange, endpoint, success: String(success) });
  }

  /**
   * Start exchange API latency timer
   */
  startExchangeApiTimer(exchange: string, endpoint: string): () => void {
    return this.exchangeApiLatency.startTimer({ exchange, endpoint });
  }

  // ===================
  // Price Metrics
  // ===================

  /**
   * Record price update received
   */
  recordPriceUpdate(source: string, count = 1): void {
    this.priceUpdatesTotal.inc({ source }, count);
  }

  /**
   * Set price update lag
   */
  setPriceUpdateLag(source: string, lagSeconds: number): void {
    this.priceUpdateLag.set({ source }, lagSeconds);
  }

  // ===================
  // Backtest Metrics
  // ===================

  /**
   * Record backtest completion
   */
  recordBacktestCompleted(strategy: string, status: 'success' | 'failed' | 'cancelled'): void {
    this.backtestsCompletedTotal.inc({ strategy, status });
  }

  /**
   * Start backtest duration timer
   */
  startBacktestTimer(strategy: string): () => void {
    return this.backtestDuration.startTimer({ strategy });
  }

  /**
   * Record quote currency fallback during backtest initialization
   */
  recordQuoteCurrencyFallback(preferred: string, actual: string): void {
    this.quoteCurrencyFallbackTotal.inc({ preferred, actual });
  }

  // ===================
  // Backtest Lifecycle Metrics
  // ===================

  /**
   * Record backtest creation
   */
  recordBacktestCreated(type: string, strategy: string): void {
    this.backtestCreatedTotal.inc({ type, strategy });
  }

  /**
   * Record backtest execution started
   */
  recordBacktestStarted(type: string, strategy: string, resumed: boolean): void {
    this.backtestStartedTotal.inc({ type, strategy, resumed: String(resumed) });
  }

  /**
   * Record backtest cancellation
   */
  recordBacktestCancelled(strategy: string): void {
    this.backtestCancelledTotal.inc({ strategy });
  }

  /**
   * Increment active backtest count
   */
  incrementActiveBacktests(type: string): void {
    this.backtestActiveCount.inc({ type });
  }

  /**
   * Decrement active backtest count
   */
  decrementActiveBacktests(type: string): void {
    this.backtestActiveCount.dec({ type });
  }

  // ===================
  // Backtest Data Loading Metrics
  // ===================

  /**
   * Start data load timer - returns function to call when done
   */
  startDataLoadTimer(source: string): () => void {
    return this.backtestDataLoadDuration.startTimer({ source });
  }

  /**
   * Record number of price records loaded
   */
  recordDataRecordsLoaded(source: string, count: number): void {
    this.backtestDataRecordsLoaded.inc({ source }, count);
  }

  // ===================
  // Backtest Trade Execution Metrics
  // ===================

  /**
   * Record simulated trade execution
   */
  recordTradeSimulated(
    strategy: string,
    type: 'buy' | 'sell',
    result: 'executed' | 'rejected_insufficient_funds' | 'rejected_no_position' | 'rejected_no_price'
  ): void {
    this.backtestTradesSimulated.inc({ strategy, type, result });
  }

  /**
   * Record slippage for a trade
   */
  recordSlippage(strategy: string, type: 'buy' | 'sell', slippageBps: number): void {
    this.backtestSlippageBps.observe({ strategy, type }, slippageBps);
  }

  // ===================
  // Backtest Algorithm Execution Metrics
  // ===================

  /**
   * Record algorithm execution
   */
  recordAlgorithmExecution(strategy: string, result: 'success' | 'error' | 'no_signals'): void {
    this.backtestAlgorithmExecutions.inc({ strategy, result });
  }

  /**
   * Record trading signal generated
   */
  recordSignalGenerated(strategy: string, action: 'buy' | 'sell' | 'hold'): void {
    this.backtestSignalsGenerated.inc({ strategy, action });
  }

  // ===================
  // Backtest Result Persistence Metrics
  // ===================

  /**
   * Start persistence timer - returns function to call when done
   */
  startPersistenceTimer(operation: 'full' | 'incremental' | 'checkpoint'): () => void {
    return this.backtestPersistenceDuration.startTimer({ operation });
  }

  /**
   * Record records persisted
   */
  recordRecordsPersisted(entityType: 'trades' | 'signals' | 'fills' | 'snapshots', count: number): void {
    if (count > 0) {
      this.backtestRecordsPersisted.inc({ entity_type: entityType }, count);
    }
  }

  // ===================
  // Backtest Resolution Metrics
  // ===================

  /**
   * Record coin resolution attempt
   */
  recordCoinResolution(result: 'success' | 'partial' | 'failed'): void {
    this.backtestCoinResolution.inc({ result });
  }

  /**
   * Record instruments resolved
   */
  recordInstrumentsResolved(method: 'direct' | 'symbol_extraction' | 'fallback', count: number): void {
    if (count > 0) {
      this.backtestInstrumentsResolved.inc({ method }, count);
    }
  }

  // ===================
  // Backtest Error Metrics
  // ===================

  /**
   * Record backtest error
   */
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

  // ===================
  // Backtest Final Results Metrics
  // ===================

  /**
   * Record backtest final metrics (call once per completed backtest)
   */
  recordBacktestFinalMetrics(
    strategy: string,
    metrics: {
      totalReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      tradeCount: number;
    }
  ): void {
    // Convert to percentage for histogram buckets
    this.backtestTotalReturn.observe({ strategy }, metrics.totalReturn * 100);
    this.backtestSharpeRatio.observe({ strategy }, metrics.sharpeRatio);
    this.backtestMaxDrawdown.observe({ strategy }, metrics.maxDrawdown * 100);
    this.backtestTradeCount.observe({ strategy }, metrics.tradeCount);
  }

  // ===================
  // Backtest Checkpoint Metrics
  // ===================

  /**
   * Record checkpoint saved during backtest execution
   */
  recordCheckpointSaved(strategy: string): void {
    this.backtestCheckpointsSavedTotal.inc({ strategy });
  }

  /**
   * Record checkpoint resume operation
   */
  recordCheckpointResumed(strategy: string): void {
    this.backtestCheckpointsResumedTotal.inc({ strategy });
  }

  /**
   * Record orphaned records cleaned during checkpoint resume
   */
  recordCheckpointOrphansCleaned(entityType: 'trades' | 'signals' | 'fills' | 'snapshots', count: number): void {
    if (count > 0) {
      this.backtestCheckpointOrphansCleanedTotal.inc({ entity_type: entityType }, count);
    }
  }

  /**
   * Set checkpoint progress for an active backtest
   */
  setCheckpointProgress(backtestId: string, strategy: string, progressPercent: number): void {
    this.backtestCheckpointProgress.set({ backtest_id: backtestId, strategy }, progressPercent);
  }

  /**
   * Clear checkpoint progress when backtest completes
   */
  clearCheckpointProgress(backtestId: string, strategy: string): void {
    this.backtestCheckpointProgress.set({ backtest_id: backtestId, strategy }, 0);
  }

  // ===================
  // Queue Metrics
  // ===================

  /**
   * Set queue job counts
   */
  setQueueJobsWaiting(queue: string, count: number): void {
    this.queueJobsWaiting.set({ queue }, count);
  }

  setQueueJobsActive(queue: string, count: number): void {
    this.queueJobsActive.set({ queue }, count);
  }

  /**
   * Record queue job completion
   */
  recordQueueJobCompleted(queue: string): void {
    this.queueJobsCompletedTotal.inc({ queue });
  }

  /**
   * Record queue job failure
   */
  recordQueueJobFailed(queue: string, errorType = 'unknown'): void {
    this.queueJobsFailedTotal.inc({ queue, error_type: errorType });
  }

  // ===================
  // Portfolio Metrics
  // ===================

  /**
   * Set portfolio total value
   */
  setPortfolioTotalValue(userId: string, valueUsd: number): void {
    this.portfolioTotalValue.set({ user_id: userId }, valueUsd);
  }

  /**
   * Set portfolio asset count
   */
  setPortfolioAssetsCount(userId: string, exchange: string, count: number): void {
    this.portfolioAssetsCount.set({ user_id: userId, exchange }, count);
  }

  // ===================
  // Strategy Metrics
  // ===================

  /**
   * Set active strategy deployments
   */
  setStrategyDeploymentsActive(strategy: string, status: string, count: number): void {
    this.strategyDeploymentsActive.set({ strategy, status }, count);
  }

  /**
   * Record strategy signal
   */
  recordStrategySignal(strategy: string, signalType: 'buy' | 'sell' | 'hold'): void {
    this.strategySignalsTotal.inc({ strategy, signal_type: signalType });
  }

  // ===================
  // Strategy Heartbeat Metrics
  // ===================

  /**
   * Record a strategy heartbeat
   */
  recordStrategyHeartbeat(strategy: string, status: 'success' | 'failed'): void {
    this.strategyHeartbeatTotal.inc({ strategy, status });
  }

  /**
   * Set the age of a strategy's last heartbeat in seconds
   */
  setStrategyHeartbeatAge(strategy: string, shadowStatus: string, ageSeconds: number): void {
    this.strategyHeartbeatAge.set({ strategy, shadow_status: shadowStatus }, ageSeconds);
  }

  /**
   * Set the number of consecutive heartbeat failures for a strategy
   */
  setStrategyHeartbeatFailures(strategy: string, failures: number): void {
    this.strategyHeartbeatFailures.set({ strategy }, failures);
  }

  /**
   * Set the health score of a strategy (0-100)
   * Health score is calculated based on:
   * - Heartbeat age (newer is better)
   * - Failure count (fewer is better)
   * - Recent signal activity
   */
  setStrategyHealthScore(strategy: string, shadowStatus: string, score: number): void {
    this.strategyHealthScore.set({ strategy, shadow_status: shadowStatus }, Math.max(0, Math.min(100, score)));
  }

  /**
   * Calculate and set health score based on heartbeat metrics
   * @param strategy Strategy name
   * @param shadowStatus Shadow status of the strategy
   * @param heartbeatAgeSeconds Age of last heartbeat in seconds
   * @param failures Number of consecutive failures
   * @param maxHeartbeatAge Maximum expected heartbeat age (e.g., 300 for 5 min interval)
   */
  calculateAndSetHealthScore(
    strategy: string,
    shadowStatus: string,
    heartbeatAgeSeconds: number,
    failures: number,
    maxHeartbeatAge = 300
  ): void {
    // Base score starts at 100
    let score = 100;

    // Deduct points for heartbeat age (max 40 points)
    // If heartbeat is older than maxHeartbeatAge, deduct proportionally
    if (heartbeatAgeSeconds > maxHeartbeatAge) {
      const ageRatio = Math.min(heartbeatAgeSeconds / (maxHeartbeatAge * 3), 1);
      score -= ageRatio * 40;
    }

    // Deduct points for failures (max 60 points)
    // Each failure deducts 15 points
    score -= Math.min(failures * 15, 60);

    this.setStrategyHealthScore(strategy, shadowStatus, score);
  }
}
