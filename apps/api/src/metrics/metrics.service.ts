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
