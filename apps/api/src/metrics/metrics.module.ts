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

    MetricsService
  ],
  exports: [PrometheusModule, MetricsService]
})
export class MetricsModule {}
