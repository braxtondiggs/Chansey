/**
 * Metrics Service (Facade)
 *
 * Delegates to domain-specific sub-services while maintaining
 * the same public API for all consumers.
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

import { BacktestMetricsService } from './services/backtest-metrics.service';
import { InfraMetricsService } from './services/infra-metrics.service';
import { StrategyMetricsService } from './services/strategy-metrics.service';
import { TradingMetricsService } from './services/trading-metrics.service';

@Injectable()
export class MetricsService {
  constructor(
    private readonly backtest: BacktestMetricsService,
    private readonly trading: TradingMetricsService,
    private readonly strategy: StrategyMetricsService,
    private readonly infra: InfraMetricsService
  ) {}

  // === HTTP / Infra ===

  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    this.infra.recordHttpRequest(method, route, statusCode, durationMs);
  }

  setActiveConnections(count: number): void {
    this.infra.setActiveConnections(count);
  }

  // === Orders / Trading ===

  recordOrdersSynced(exchange: string, status: 'success' | 'partial' | 'failed', count = 1): void {
    this.trading.recordOrdersSynced(exchange, status, count);
  }

  recordOrderSyncError(exchange: string, errorType: string): void {
    this.trading.recordOrderSyncError(exchange, errorType);
  }

  startOrderSyncTimer(exchange: string): () => void {
    return this.trading.startOrderSyncTimer(exchange);
  }

  recordTradeExecuted(exchange: string, side: 'buy' | 'sell', symbol: string): void {
    this.trading.recordTradeExecuted(exchange, side, symbol);
  }

  startTradeExecutionTimer(exchange: string): () => void {
    return this.trading.startTradeExecutionTimer(exchange);
  }

  // === Exchange ===

  setExchangeConnections(exchange: string, count: number): void {
    this.trading.setExchangeConnections(exchange, count);
  }

  recordExchangeApiCall(exchange: string, endpoint: string, success: boolean): void {
    this.trading.recordExchangeApiCall(exchange, endpoint, success);
  }

  startExchangeApiTimer(exchange: string, endpoint: string): () => void {
    return this.trading.startExchangeApiTimer(exchange, endpoint);
  }

  // === Price ===

  recordPriceUpdate(source: string, count = 1): void {
    this.infra.recordPriceUpdate(source, count);
  }

  setPriceUpdateLag(source: string, lagSeconds: number): void {
    this.infra.setPriceUpdateLag(source, lagSeconds);
  }

  // === Coin Selection ===

  recordDiversityPruningFallback(reason: 'no_ohlc' | 'backfill_after_veto'): void {
    this.infra.recordDiversityPruningFallback(reason);
  }

  // === Backtest ===

  recordBacktestCompleted(strategy: string, status: 'success' | 'failed' | 'cancelled'): void {
    this.backtest.recordBacktestCompleted(strategy, status);
  }

  startBacktestTimer(strategy: string): () => void {
    return this.backtest.startBacktestTimer(strategy);
  }

  recordQuoteCurrencyFallback(preferred: string, actual: string): void {
    this.backtest.recordQuoteCurrencyFallback(preferred, actual);
  }

  recordBacktestCreated(type: string, strategy: string): void {
    this.backtest.recordBacktestCreated(type, strategy);
  }

  recordBacktestStarted(type: string, strategy: string, resumed: boolean): void {
    this.backtest.recordBacktestStarted(type, strategy, resumed);
  }

  recordBacktestCancelled(strategy: string): void {
    this.backtest.recordBacktestCancelled(strategy);
  }

  incrementActiveBacktests(type: string): void {
    this.backtest.incrementActiveBacktests(type);
  }

  decrementActiveBacktests(type: string): void {
    this.backtest.decrementActiveBacktests(type);
  }

  startDataLoadTimer(source: string): () => void {
    return this.backtest.startDataLoadTimer(source);
  }

  recordDataRecordsLoaded(source: string, count: number): void {
    this.backtest.recordDataRecordsLoaded(source, count);
  }

  recordTradeSimulated(
    strategy: string,
    type: 'buy' | 'sell',
    result: 'executed' | 'rejected_insufficient_funds' | 'rejected_no_position' | 'rejected_no_price'
  ): void {
    this.backtest.recordTradeSimulated(strategy, type, result);
  }

  recordSlippage(strategy: string, type: 'buy' | 'sell', slippageBps: number): void {
    this.backtest.recordSlippage(strategy, type, slippageBps);
  }

  recordAlgorithmExecution(strategy: string, result: 'success' | 'error' | 'no_signals'): void {
    this.backtest.recordAlgorithmExecution(strategy, result);
  }

  recordSignalGenerated(strategy: string, action: 'buy' | 'sell' | 'hold'): void {
    this.backtest.recordSignalGenerated(strategy, action);
  }

  startPersistenceTimer(operation: 'full' | 'incremental' | 'checkpoint'): () => void {
    return this.backtest.startPersistenceTimer(operation);
  }

  recordRecordsPersisted(entityType: 'trades' | 'signals' | 'fills' | 'snapshots', count: number): void {
    this.backtest.recordRecordsPersisted(entityType, count);
  }

  recordCoinResolution(result: 'success' | 'partial' | 'failed'): void {
    this.backtest.recordCoinResolution(result);
  }

  recordInstrumentsResolved(method: 'direct' | 'symbol_extraction' | 'fallback', count: number): void {
    this.backtest.recordInstrumentsResolved(method, count);
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
    this.backtest.recordBacktestError(strategy, errorType);
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
    this.backtest.recordBacktestFinalMetrics(strategy, metrics);
  }

  recordCheckpointSaved(strategy: string): void {
    this.backtest.recordCheckpointSaved(strategy);
  }

  recordCheckpointResumed(strategy: string): void {
    this.backtest.recordCheckpointResumed(strategy);
  }

  recordCheckpointOrphansCleaned(entityType: 'trades' | 'signals' | 'fills' | 'snapshots', count: number): void {
    this.backtest.recordCheckpointOrphansCleaned(entityType, count);
  }

  setCheckpointProgress(backtestId: string, strategy: string, progressPercent: number): void {
    this.backtest.setCheckpointProgress(backtestId, strategy, progressPercent);
  }

  clearCheckpointProgress(backtestId: string, strategy: string): void {
    this.backtest.clearCheckpointProgress(backtestId, strategy);
  }

  // === Queue ===

  setQueueJobsWaiting(queue: string, count: number): void {
    this.infra.setQueueJobsWaiting(queue, count);
  }

  setQueueJobsActive(queue: string, count: number): void {
    this.infra.setQueueJobsActive(queue, count);
  }

  recordQueueJobCompleted(queue: string): void {
    this.infra.recordQueueJobCompleted(queue);
  }

  recordQueueJobFailed(queue: string, errorType = 'unknown'): void {
    this.infra.recordQueueJobFailed(queue, errorType);
  }

  // === Portfolio / Strategy ===

  setPortfolioTotalValue(userId: string, valueUsd: number): void {
    this.strategy.setPortfolioTotalValue(userId, valueUsd);
  }

  setPortfolioAssetsCount(userId: string, exchange: string, count: number): void {
    this.strategy.setPortfolioAssetsCount(userId, exchange, count);
  }

  setStrategyDeploymentsActive(strategy: string, status: string, count: number): void {
    this.strategy.setStrategyDeploymentsActive(strategy, status, count);
  }

  recordStrategySignal(strategy: string, signalType: 'buy' | 'sell' | 'hold'): void {
    this.strategy.recordStrategySignal(strategy, signalType);
  }

  recordStrategyHeartbeat(strategy: string, status: 'success' | 'failed'): void {
    this.strategy.recordStrategyHeartbeat(strategy, status);
  }

  setStrategyHeartbeatAge(strategy: string, shadowStatus: string, ageSeconds: number): void {
    this.strategy.setStrategyHeartbeatAge(strategy, shadowStatus, ageSeconds);
  }

  setStrategyHeartbeatFailures(strategy: string, failures: number): void {
    this.strategy.setStrategyHeartbeatFailures(strategy, failures);
  }

  setStrategyHealthScore(strategy: string, shadowStatus: string, score: number): void {
    this.strategy.setStrategyHealthScore(strategy, shadowStatus, score);
  }

  // === Live Trading & Throttle ===

  recordTradeCooldownBlock(direction: string, symbol: string): void {
    this.trading.recordTradeCooldownBlock(direction, symbol);
  }

  recordTradeCooldownClaim(direction: string, symbol: string): void {
    this.trading.recordTradeCooldownClaim(direction, symbol);
  }

  recordTradeCooldownCleared(reason: string): void {
    this.trading.recordTradeCooldownCleared(reason);
  }

  recordSignalThrottleSuppressed(strategy: string, count: number): void {
    this.trading.recordSignalThrottleSuppressed(strategy, count);
  }

  recordSignalThrottlePassed(strategy: string, action: string): void {
    this.trading.recordSignalThrottlePassed(strategy, action);
  }

  recordRegimeGateBlock(regime: string): void {
    this.trading.recordRegimeGateBlock(regime);
  }

  recordDrawdownGateBlock(): void {
    this.trading.recordDrawdownGateBlock();
  }

  recordDailyLossGateBlock(): void {
    this.trading.recordDailyLossGateBlock();
  }

  recordConcentrationGateBlock(): void {
    this.trading.recordConcentrationGateBlock();
  }

  recordLiveOrderPlaced(marketType: 'futures' | 'spot', side: string): void {
    this.trading.recordLiveOrderPlaced(marketType, side);
  }

  calculateAndSetHealthScore(
    strategy: string,
    shadowStatus: string,
    heartbeatAgeSeconds: number,
    failures: number,
    maxHeartbeatAge = 300
  ): void {
    this.strategy.calculateAndSetHealthScore(strategy, shadowStatus, heartbeatAgeSeconds, failures, maxHeartbeatAge);
  }
}
