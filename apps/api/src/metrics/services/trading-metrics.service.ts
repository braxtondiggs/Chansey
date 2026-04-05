import { Injectable } from '@nestjs/common';

import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';

@Injectable()
export class TradingMetricsService {
  constructor(
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

    // Live Trading & Throttle Metrics
    @InjectMetric('chansey_trade_cooldown_blocks_total')
    private readonly tradeCooldownBlocksTotal: Counter<string>,
    @InjectMetric('chansey_trade_cooldown_claims_total')
    private readonly tradeCooldownClaimsTotal: Counter<string>,
    @InjectMetric('chansey_trade_cooldown_cleared_total')
    private readonly tradeCooldownClearedTotal: Counter<string>,
    @InjectMetric('chansey_signal_throttle_suppressed_total')
    private readonly signalThrottleSuppressedTotal: Counter<string>,
    @InjectMetric('chansey_signal_throttle_passed_total')
    private readonly signalThrottlePassedTotal: Counter<string>,
    @InjectMetric('chansey_regime_gate_blocks_total')
    private readonly regimeGateBlocksTotal: Counter<string>,
    @InjectMetric('chansey_drawdown_gate_blocks_total')
    private readonly drawdownGateBlocksTotal: Counter<string>,
    @InjectMetric('chansey_daily_loss_gate_blocks_total')
    private readonly dailyLossGateBlocksTotal: Counter<string>,
    @InjectMetric('chansey_concentration_gate_blocks_total')
    private readonly concentrationGateBlocksTotal: Counter<string>,
    @InjectMetric('chansey_live_orders_placed_total')
    private readonly liveOrdersPlacedTotal: Counter<string>
  ) {}

  recordOrdersSynced(exchange: string, status: 'success' | 'partial' | 'failed', count = 1): void {
    this.ordersSyncedTotal.inc({ exchange, status }, count);
  }

  recordOrderSyncError(exchange: string, errorType: string): void {
    this.ordersSyncErrorsTotal.inc({ exchange, error_type: errorType });
  }

  startOrderSyncTimer(exchange: string): () => void {
    const end = this.orderSyncDuration.startTimer({ exchange });
    return end;
  }

  recordTradeExecuted(exchange: string, side: 'buy' | 'sell', symbol: string): void {
    this.tradesExecutedTotal.inc({ exchange, side, symbol });
  }

  startTradeExecutionTimer(exchange: string): () => void {
    return this.tradeExecutionDuration.startTimer({ exchange });
  }

  setExchangeConnections(exchange: string, count: number): void {
    this.exchangeConnections.set({ exchange }, count);
  }

  recordExchangeApiCall(exchange: string, endpoint: string, success: boolean): void {
    this.exchangeApiCallsTotal.inc({ exchange, endpoint, success: String(success) });
  }

  startExchangeApiTimer(exchange: string, endpoint: string): () => void {
    return this.exchangeApiLatency.startTimer({ exchange, endpoint });
  }

  recordTradeCooldownBlock(direction: string, symbol: string): void {
    this.tradeCooldownBlocksTotal.inc({ direction, symbol });
  }

  recordTradeCooldownClaim(direction: string, symbol: string): void {
    this.tradeCooldownClaimsTotal.inc({ direction, symbol });
  }

  recordTradeCooldownCleared(reason: string): void {
    this.tradeCooldownClearedTotal.inc({ reason });
  }

  recordSignalThrottleSuppressed(strategy: string, count: number): void {
    this.signalThrottleSuppressedTotal.inc({ strategy }, count);
  }

  recordSignalThrottlePassed(strategy: string, action: string): void {
    this.signalThrottlePassedTotal.inc({ strategy, action });
  }

  recordRegimeGateBlock(regime: string): void {
    this.regimeGateBlocksTotal.inc({ regime });
  }

  recordDrawdownGateBlock(): void {
    this.drawdownGateBlocksTotal.inc();
  }

  recordDailyLossGateBlock(): void {
    this.dailyLossGateBlocksTotal.inc();
  }

  recordConcentrationGateBlock(): void {
    this.concentrationGateBlocksTotal.inc();
  }

  recordLiveOrderPlaced(marketType: 'futures' | 'spot', side: string): void {
    this.liveOrdersPlacedTotal.inc({ market_type: marketType, side });
  }
}
