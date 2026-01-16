/**
 * Prometheus Metrics Module
 *
 * Provides application metrics exposed at /api/metrics endpoint.
 * Prometheus can scrape this endpoint to collect metrics.
 *
 * Features:
 * - Default Node.js metrics (CPU, memory, event loop)
 * - HTTP request metrics (duration, count by route/status)
 * - Custom business metrics (orders, trades, exchange sync)
 *
 * @see {@link https://github.com/willsoto/nestjs-prometheus}
 */

import { Module } from '@nestjs/common';

import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
  PrometheusModule
} from '@willsoto/nestjs-prometheus';

import { MetricsService } from './metrics.service';

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
        config: {
          prefix: 'chansey_'
        }
      },
      defaultLabels: {
        app: 'chansey-api',
        env: process.env.NODE_ENV || 'development'
      }
    })
  ],
  providers: [
    // HTTP Request Duration Histogram
    makeHistogramProvider({
      name: 'chansey_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
    }),

    // HTTP Request Counter
    makeCounterProvider({
      name: 'chansey_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code']
    }),

    // Active HTTP Connections Gauge
    makeGaugeProvider({
      name: 'chansey_http_connections_active',
      help: 'Number of active HTTP connections'
    }),

    // ===================
    // Business Metrics
    // ===================

    // Order Metrics
    makeCounterProvider({
      name: 'chansey_orders_synced_total',
      help: 'Total number of orders synced from exchanges',
      labelNames: ['exchange', 'status']
    }),

    makeCounterProvider({
      name: 'chansey_orders_sync_errors_total',
      help: 'Total number of order sync errors',
      labelNames: ['exchange', 'error_type']
    }),

    makeHistogramProvider({
      name: 'chansey_order_sync_duration_seconds',
      help: 'Duration of order sync operations',
      labelNames: ['exchange'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60]
    }),

    // Trade Execution Metrics
    makeCounterProvider({
      name: 'chansey_trades_executed_total',
      help: 'Total number of trades executed',
      labelNames: ['exchange', 'side', 'symbol']
    }),

    makeHistogramProvider({
      name: 'chansey_trade_execution_duration_seconds',
      help: 'Duration of trade execution',
      labelNames: ['exchange'],
      buckets: [0.1, 0.5, 1, 2, 5, 10]
    }),

    // Exchange Connection Metrics
    makeGaugeProvider({
      name: 'chansey_exchange_connections',
      help: 'Number of active exchange connections',
      labelNames: ['exchange']
    }),

    makeCounterProvider({
      name: 'chansey_exchange_api_calls_total',
      help: 'Total number of exchange API calls',
      labelNames: ['exchange', 'endpoint', 'success']
    }),

    makeHistogramProvider({
      name: 'chansey_exchange_api_latency_seconds',
      help: 'Latency of exchange API calls',
      labelNames: ['exchange', 'endpoint'],
      buckets: [0.1, 0.25, 0.5, 1, 2, 5]
    }),

    // Price Data Metrics
    makeCounterProvider({
      name: 'chansey_price_updates_total',
      help: 'Total number of price updates received',
      labelNames: ['source']
    }),

    makeGaugeProvider({
      name: 'chansey_price_update_lag_seconds',
      help: 'Lag between price timestamp and receive time',
      labelNames: ['source']
    }),

    // Backtest Metrics
    makeCounterProvider({
      name: 'chansey_backtests_completed_total',
      help: 'Total number of backtests completed',
      labelNames: ['strategy', 'status']
    }),

    makeHistogramProvider({
      name: 'chansey_backtest_duration_seconds',
      help: 'Duration of backtest execution',
      labelNames: ['strategy'],
      buckets: [1, 5, 10, 30, 60, 120, 300]
    }),

    makeCounterProvider({
      name: 'chansey_backtest_quote_currency_fallback_total',
      help: 'Total number of quote currency fallbacks during backtest initialization',
      labelNames: ['preferred', 'actual']
    }),

    // Backtest Lifecycle Metrics
    makeCounterProvider({
      name: 'chansey_backtest_created_total',
      help: 'Total number of backtests created',
      labelNames: ['type', 'strategy']
    }),

    makeCounterProvider({
      name: 'chansey_backtest_started_total',
      help: 'Total number of backtests started execution',
      labelNames: ['type', 'strategy', 'resumed']
    }),

    makeCounterProvider({
      name: 'chansey_backtest_cancelled_total',
      help: 'Total number of backtests cancelled',
      labelNames: ['strategy']
    }),

    makeGaugeProvider({
      name: 'chansey_backtest_active_count',
      help: 'Number of currently active/running backtests',
      labelNames: ['type']
    }),

    // Backtest Data Loading Metrics
    makeHistogramProvider({
      name: 'chansey_backtest_data_load_duration_seconds',
      help: 'Duration of market data loading for backtests',
      labelNames: ['source'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
    }),

    makeCounterProvider({
      name: 'chansey_backtest_data_records_loaded_total',
      help: 'Total number of price records loaded for backtests',
      labelNames: ['source']
    }),

    // Backtest Trade Execution Metrics
    makeCounterProvider({
      name: 'chansey_backtest_trades_simulated_total',
      help: 'Total number of simulated trades executed',
      labelNames: ['strategy', 'type', 'result']
    }),

    makeHistogramProvider({
      name: 'chansey_backtest_slippage_bps',
      help: 'Distribution of slippage in basis points',
      labelNames: ['strategy', 'type'],
      buckets: [1, 2, 5, 10, 20, 50, 100]
    }),

    // Backtest Algorithm Execution Metrics
    makeCounterProvider({
      name: 'chansey_backtest_algorithm_executions_total',
      help: 'Total number of algorithm executions during backtests',
      labelNames: ['strategy', 'result']
    }),

    makeCounterProvider({
      name: 'chansey_backtest_signals_generated_total',
      help: 'Total number of trading signals generated during backtests',
      labelNames: ['strategy', 'action']
    }),

    // Backtest Result Persistence Metrics
    makeHistogramProvider({
      name: 'chansey_backtest_persistence_duration_seconds',
      help: 'Duration of backtest result persistence operations',
      labelNames: ['operation'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
    }),

    makeCounterProvider({
      name: 'chansey_backtest_records_persisted_total',
      help: 'Total number of records persisted for backtests',
      labelNames: ['entity_type']
    }),

    // Backtest Resolution Metrics
    makeCounterProvider({
      name: 'chansey_backtest_coin_resolution_total',
      help: 'Total coin resolution attempts for backtests',
      labelNames: ['result']
    }),

    makeCounterProvider({
      name: 'chansey_backtest_instruments_resolved_total',
      help: 'Total instruments resolved for backtests',
      labelNames: ['method']
    }),

    // Backtest Error Metrics
    makeCounterProvider({
      name: 'chansey_backtest_errors_total',
      help: 'Total number of backtest errors by category',
      labelNames: ['strategy', 'error_type']
    }),

    // Backtest Final Results Metrics
    makeHistogramProvider({
      name: 'chansey_backtest_total_return_percent',
      help: 'Distribution of backtest total returns',
      labelNames: ['strategy'],
      buckets: [-50, -25, -10, -5, 0, 5, 10, 25, 50, 100, 200]
    }),

    makeHistogramProvider({
      name: 'chansey_backtest_sharpe_ratio',
      help: 'Distribution of backtest Sharpe ratios',
      labelNames: ['strategy'],
      buckets: [-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 5]
    }),

    makeHistogramProvider({
      name: 'chansey_backtest_max_drawdown_percent',
      help: 'Distribution of backtest maximum drawdowns',
      labelNames: ['strategy'],
      buckets: [0, 5, 10, 15, 20, 30, 40, 50, 75, 100]
    }),

    makeHistogramProvider({
      name: 'chansey_backtest_trade_count',
      help: 'Distribution of trade counts per backtest',
      labelNames: ['strategy'],
      buckets: [0, 10, 25, 50, 100, 250, 500, 1000, 2500]
    }),

    // Backtest Checkpoint Metrics
    makeCounterProvider({
      name: 'chansey_backtest_checkpoints_saved_total',
      help: 'Total number of backtest checkpoints saved',
      labelNames: ['strategy']
    }),

    makeCounterProvider({
      name: 'chansey_backtest_checkpoints_resumed_total',
      help: 'Total number of backtest checkpoint resumes',
      labelNames: ['strategy']
    }),

    makeCounterProvider({
      name: 'chansey_backtest_checkpoint_orphans_cleaned_total',
      help: 'Total number of orphaned records cleaned during checkpoint resume',
      labelNames: ['entity_type']
    }),

    makeGaugeProvider({
      name: 'chansey_backtest_checkpoint_progress_percent',
      help: 'Current checkpoint progress percentage for active backtests',
      labelNames: ['backtest_id', 'strategy']
    }),

    // Queue Metrics
    makeGaugeProvider({
      name: 'chansey_queue_jobs_waiting',
      help: 'Number of jobs waiting in queue',
      labelNames: ['queue']
    }),

    makeGaugeProvider({
      name: 'chansey_queue_jobs_active',
      help: 'Number of active jobs in queue',
      labelNames: ['queue']
    }),

    makeCounterProvider({
      name: 'chansey_queue_jobs_completed_total',
      help: 'Total number of completed queue jobs',
      labelNames: ['queue']
    }),

    makeCounterProvider({
      name: 'chansey_queue_jobs_failed_total',
      help: 'Total number of failed queue jobs',
      labelNames: ['queue', 'error_type']
    }),

    // Portfolio Metrics
    makeGaugeProvider({
      name: 'chansey_portfolio_total_value_usd',
      help: 'Total portfolio value in USD',
      labelNames: ['user_id']
    }),

    makeGaugeProvider({
      name: 'chansey_portfolio_assets_count',
      help: 'Number of assets in portfolio',
      labelNames: ['user_id', 'exchange']
    }),

    // Strategy Deployment Metrics
    makeGaugeProvider({
      name: 'chansey_strategy_deployments_active',
      help: 'Number of active strategy deployments',
      labelNames: ['strategy', 'status']
    }),

    makeCounterProvider({
      name: 'chansey_strategy_signals_total',
      help: 'Total number of strategy signals generated',
      labelNames: ['strategy', 'signal_type']
    }),

    // Strategy Heartbeat Metrics
    makeGaugeProvider({
      name: 'chansey_strategy_heartbeat_age_seconds',
      help: 'Age of the last heartbeat in seconds (time since last heartbeat)',
      labelNames: ['strategy', 'shadow_status']
    }),

    makeCounterProvider({
      name: 'chansey_strategy_heartbeat_total',
      help: 'Total number of heartbeats received',
      labelNames: ['strategy', 'status']
    }),

    makeGaugeProvider({
      name: 'chansey_strategy_heartbeat_failures',
      help: 'Number of consecutive heartbeat failures',
      labelNames: ['strategy']
    }),

    makeGaugeProvider({
      name: 'chansey_strategy_health_score',
      help: 'Health score of strategy (0-100)',
      labelNames: ['strategy', 'shadow_status']
    }),

    MetricsService
  ],
  exports: [PrometheusModule, MetricsService]
})
export class MetricsModule {}
