import { Injectable, Logger } from '@nestjs/common';

import { getAllocationLimits, PipelineStage, SignalReasonCode } from '@chansey/api-interfaces';

import { toExitType, TradingSignal } from './paper-trading-engine.utils';
import { PaperTradingOrderExecutorService } from './paper-trading-order-executor.service';
import { PaperTradingPortfolioService } from './paper-trading-portfolio.service';
import { PaperTradingSignalService } from './paper-trading-signal.service';

import { SignalType as AlgoSignalType } from '../../../algorithm/interfaces';
import { CandleData } from '../../../ohlc/ohlc-candle.entity';
import { DEFAULT_RISK_LEVEL } from '../../../risk/risk.constants';
import { toErrorInfo } from '../../../shared/error.util';
import { BacktestExitTracker, computeAtrFromOHLC, SerializableExitTrackerState } from '../../backtest/shared';
import { resolveExitConfig } from '../../utils/exit-config-merge.util';
import { PaperTradingOrder, PaperTradingSession, PaperTradingSignal, PaperTradingSignalStatus } from '../entities';

/**
 * Owns per-session BacktestExitTracker instances and orchestrates SL/TP/trailing
 * stop checks + exit order execution for the paper-trading engine.
 */
@Injectable()
export class PaperTradingExitExecutorService {
  private readonly logger = new Logger(PaperTradingExitExecutorService.name);

  /** In-memory exit tracker per session. */
  private readonly exitTrackers = new Map<string, BacktestExitTracker>();

  constructor(
    private readonly portfolioService: PaperTradingPortfolioService,
    private readonly signalService: PaperTradingSignalService,
    private readonly orderExecutor: PaperTradingOrderExecutorService
  ) {}

  /**
   * Get or create an exit tracker for a session. Returns null if the session
   * has no exitConfig (feature flag — backward compatible).
   */
  getOrCreate(session: PaperTradingSession): BacktestExitTracker | null {
    if (!session.exitConfig) return null;

    let tracker = this.exitTrackers.get(session.id);
    if (!tracker) {
      const config = resolveExitConfig(session.exitConfig);
      if (session.exitTrackerState) {
        tracker = BacktestExitTracker.deserialize(session.exitTrackerState, config);
      } else {
        tracker = new BacktestExitTracker(config);
      }
      this.exitTrackers.set(session.id, tracker);
    }
    return tracker;
  }

  /** Clean up exit tracker when a session ends. */
  clear(sessionId: string): void {
    this.exitTrackers.delete(sessionId);
  }

  /** Serialize current tracker state for DB persistence. */
  serialize(sessionId: string): SerializableExitTrackerState | undefined {
    const tracker = this.exitTrackers.get(sessionId);
    if (!tracker) return undefined;
    return tracker.serialize();
  }

  /**
   * Drop in-memory tracker state for sessions that are no longer active.
   * @returns number of sessions swept
   */
  sweep(activeSessionIds: Set<string>): number {
    let swept = 0;
    for (const sessionId of this.exitTrackers.keys()) {
      if (!activeSessionIds.has(sessionId)) {
        this.exitTrackers.delete(sessionId);
        swept++;
      }
    }
    return swept;
  }

  /**
   * Register an entry in the exit tracker after a successful BUY fill.
   * Computes ATR from historical candles when available.
   */
  onBuyFill(
    session: PaperTradingSession,
    signal: TradingSignal,
    order: PaperTradingOrder,
    historicalCandles: Record<string, CandleData[]>
  ): void {
    const tracker = this.exitTrackers.get(session.id);
    if (!tracker) return;

    const [baseCurrency] = signal.symbol.split('/');
    const candles = historicalCandles[signal.symbol];
    let atr: number | undefined;
    if (candles && candles.length > 0) {
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.avg);
      atr = computeAtrFromOHLC(highs, lows, closes, session.exitConfig?.atrPeriod ?? 14);
    }

    if (order.executedPrice != null && order.executedPrice > 0) {
      tracker.onBuy(baseCurrency, order.executedPrice, order.filledQuantity, atr);
    } else {
      this.logger.warn(
        `Skipping exit tracker registration for ${baseCurrency}: executedPrice is ${order.executedPrice}`
      );
    }
  }

  /** Update the tracker after a successful SELL fill. */
  onSellFill(session: PaperTradingSession, signal: TradingSignal, order: PaperTradingOrder): void {
    const tracker = this.exitTrackers.get(session.id);
    if (!tracker) return;
    const [baseCurrency] = signal.symbol.split('/');
    tracker.onSell(baseCurrency, order.filledQuantity);
  }

  /**
   * Check exit levels and execute exit orders for triggered positions.
   * Returns the number of exit orders successfully executed.
   */
  async checkAndExecute(
    session: PaperTradingSession,
    priceMap: Record<string, number>,
    historicalCandles: Record<string, CandleData[]>,
    quoteCurrency: string,
    exchangeSlug: string,
    timestamp: Date
  ): Promise<number> {
    const exitTracker = this.exitTrackers.get(session.id);
    if (!exitTracker || exitTracker.size === 0) return 0;

    // Build close/low/high price maps from current prices + last candle data.
    const closePrices = new Map<string, number>();
    const lowPrices = new Map<string, number>();
    const highPrices = new Map<string, number>();

    for (const [symbol, price] of Object.entries(priceMap)) {
      const [baseCurrency] = symbol.split('/');
      closePrices.set(baseCurrency, price);

      const candles = historicalCandles[symbol];
      if (candles && candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        lowPrices.set(baseCurrency, Math.min(lastCandle.low, price));
        highPrices.set(baseCurrency, Math.max(lastCandle.high, price));
      } else {
        lowPrices.set(baseCurrency, price);
        highPrices.set(baseCurrency, price);
      }
    }

    const exitSignals = exitTracker.checkExits(closePrices, lowPrices, highPrices);
    if (exitSignals.length === 0) return 0;

    const { portfolio: currentPortfolio } = await this.portfolioService.refresh(session.id, priceMap, quoteCurrency);

    const { maxAllocation, minAllocation } = getAllocationLimits(
      PipelineStage.PAPER_TRADE,
      session.riskLevel ?? DEFAULT_RISK_LEVEL
    );

    let ordersExecuted = 0;
    for (const exit of exitSignals) {
      let signalEntity: PaperTradingSignal | undefined;
      try {
        const exitTradingSignal: TradingSignal = {
          action: 'SELL',
          coinId: exit.coinId,
          symbol: `${exit.coinId}/${quoteCurrency}`,
          quantity: exit.quantity,
          reason: exit.reason,
          metadata: exit.metadata as Record<string, any>,
          originalType:
            exit.exitType === 'STOP_LOSS'
              ? AlgoSignalType.STOP_LOSS
              : exit.exitType === 'TAKE_PROFIT'
                ? AlgoSignalType.TAKE_PROFIT
                : AlgoSignalType.STOP_LOSS
        };

        signalEntity = await this.signalService.save(session, exitTradingSignal);

        const exitPriceMap = { ...priceMap, [`${exit.coinId}/${quoteCurrency}`]: exit.executionPrice };

        const result = await this.orderExecutor.execute({
          session,
          signal: exitTradingSignal,
          signalEntity,
          portfolio: currentPortfolio,
          prices: exitPriceMap,
          exchangeSlug,
          quoteCurrency,
          timestamp,
          allocation: { maxAllocation, minAllocation },
          exitType: toExitType(exit.exitType)
        });

        if (result.status === 'success') {
          ordersExecuted++;
          exitTracker.removePosition(exit.coinId);
          signalEntity.status = PaperTradingSignalStatus.SIMULATED;
          await this.signalService.markProcessed(signalEntity);
          this.logger.log(
            `Exit triggered for ${exit.coinId} in session ${session.id}: ${exit.exitType} at ${exit.executionPrice.toFixed(2)}`
          );
        } else if (result.status === 'no_position') {
          exitTracker.removePosition(exit.coinId);
          signalEntity.status = PaperTradingSignalStatus.SIMULATED;
          await this.signalService.markProcessed(signalEntity);
          this.logger.log(
            `Exit cleanup for ${exit.coinId} in session ${session.id}: position already closed (${result.status})`
          );
        } else {
          signalEntity.status = PaperTradingSignalStatus.REJECTED;
          if (result.status === 'no_price') {
            signalEntity.rejectionCode = SignalReasonCode.SYMBOL_RESOLUTION_FAILED;
          } else if (result.status === 'insufficient_funds') {
            signalEntity.rejectionCode = SignalReasonCode.INSUFFICIENT_FUNDS;
          } else if (result.status === 'hold_period') {
            signalEntity.rejectionCode = SignalReasonCode.TRADE_COOLDOWN;
          }
          await this.signalService.markProcessed(signalEntity);
          this.logger.warn(
            `Exit deferred for ${exit.coinId} in session ${session.id}: ${result.status} — will retry next tick`
          );
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        if (signalEntity) {
          signalEntity.status = PaperTradingSignalStatus.ERROR;
          await this.signalService.markProcessed(signalEntity);
        }
        this.logger.warn(`Failed to execute exit order for ${exit.coinId}: ${err.message}`);
      }
    }

    return ordersExecuted;
  }
}
