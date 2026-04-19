import { Injectable, Logger } from '@nestjs/common';

import { Decimal } from 'decimal.js';

import { SignalType as AlgoSignalType } from '../../../../algorithm/interfaces';
import { Coin } from '../../../../coin/coin.entity';
import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { ExitConfig } from '../../../interfaces/exit-config.interface';
import { resolveExitConfig } from '../../../utils/exit-config-merge.util';
import { BacktestSignal, SignalDirection, SignalType } from '../../backtest-signal.entity';
import { BacktestTrade } from '../../backtest-trade.entity';
import { Backtest } from '../../backtest.entity';
import { SimulatedOrderFill, SimulatedOrderStatus, SimulatedOrderType } from '../../simulated-order-fill.entity';
import { BacktestExitTracker, SerializableExitTrackerState, DEFAULT_BACKTEST_EXIT_CONFIG } from '../exits';
import { Portfolio } from '../portfolio';
import { DEFAULT_SLIPPAGE_CONFIG, SlippageConfig } from '../slippage';
import { BuildSpreadContextFn, ExecuteTradeFn, ExtractDailyVolumeFn, MarketData, TradingSignal } from '../types';

/**
 * Options for resolving an exit tracker from configuration.
 */
export interface ResolveExitTrackerOptions {
  exitConfig?: ExitConfig;
  enableHardStopLoss?: boolean;
  hardStopLossPercent?: number;
  resumeExitTrackerState?: SerializableExitTrackerState;
}

/**
 * Options for processing exit signals on the current bar.
 */
export interface ProcessExitSignalsOptions {
  exitTracker: BacktestExitTracker;
  currentPrices: OHLCCandle[];
  marketData: MarketData;
  portfolio: Portfolio;
  tradingFee: number;
  timestamp: Date;
  trades: Partial<BacktestTrade>[];
  slippageConfig?: SlippageConfig;
  maxAllocation?: number;
  minAllocation?: number;
  // Full-fidelity fields (omit for lightweight optimization mode)
  signals?: Partial<BacktestSignal>[];
  simulatedFills?: Partial<SimulatedOrderFill>[];
  backtest?: Backtest;
  coinMap?: Map<string, Coin>;
  quoteCoin?: Coin;
  prevCandleMap?: Map<string, OHLCCandle>;
  /**
   * Current bar index. Required so the exit tracker can record re-entry cooldowns
   * consistently across optimizer and full-backtest paths.
   */
  currentBar: number;
}

/**
 * Callbacks object passed to processExitSignals so the service
 * can delegate trade execution and slippage context building
 * to the caller without a circular dependency.
 */
export interface ProcessExitSignalsCallbacks {
  executeTradeFn: ExecuteTradeFn;
  extractDailyVolumeFn: ExtractDailyVolumeFn;
  buildSpreadContextFn: BuildSpreadContextFn;
}

/**
 * Processes exit signals (stop-loss, take-profit, trailing stop) for
 * backtest positions. Extracted from BacktestEngine to allow reuse
 * across all execution paths (historical, live-replay, optimization).
 */
@Injectable()
export class ExitSignalProcessorService {
  private readonly logger = new Logger('ExitSignalProcessorService');

  /**
   * Resolve the effective ExitConfig and instantiate a BacktestExitTracker.
   *
   * Centralises the exit-tracker initialisation logic shared by all four
   * execution paths (historical, live-replay, optimization, optimization-precomputed).
   */
  resolveExitTracker(opts: ResolveExitTrackerOptions): BacktestExitTracker | null {
    const effectiveExitConfig = opts.exitConfig
      ? resolveExitConfig(DEFAULT_BACKTEST_EXIT_CONFIG, opts.exitConfig)
      : opts.enableHardStopLoss !== false
        ? { ...DEFAULT_BACKTEST_EXIT_CONFIG, stopLossValue: (opts.hardStopLossPercent ?? 0.05) * 100 }
        : null;

    if (
      !effectiveExitConfig ||
      (!effectiveExitConfig.enableStopLoss &&
        !effectiveExitConfig.enableTakeProfit &&
        !effectiveExitConfig.enableTrailingStop)
    ) {
      return null;
    }

    return opts.resumeExitTrackerState
      ? BacktestExitTracker.deserialize(opts.resumeExitTrackerState, effectiveExitConfig)
      : new BacktestExitTracker(effectiveExitConfig);
  }

  /**
   * Process exit signals (SL/TP/trailing) for the current bar.
   *
   * When `signals`, `simulatedFills`, and `backtest` are all provided, runs in
   * full-fidelity mode (historical / live-replay) and records BacktestSignal and
   * SimulatedOrderFill entries. Otherwise runs in lightweight mode (optimization)
   * and pushes only minimal trade records.
   */
  async processExitSignals(opts: ProcessExitSignalsOptions, callbacks: ProcessExitSignalsCallbacks): Promise<void> {
    const { exitTracker, currentPrices, marketData, portfolio, tradingFee, timestamp, trades } = opts;

    if (exitTracker.size === 0) return;

    const priceMap = new Map(currentPrices.map((c) => [c.coinId, c]));
    const lowPrices = new Map(currentPrices.map((c) => [c.coinId, c.low]));
    const highPrices = new Map(currentPrices.map((c) => [c.coinId, c.high]));
    const exitSignals = exitTracker.checkExits(marketData.prices, lowPrices, highPrices, opts.currentBar);

    const fullFidelity = !!(opts.signals && opts.simulatedFills && opts.backtest);

    for (const exitSig of exitSignals) {
      const exitTradingSignal: TradingSignal = {
        action: 'SELL',
        coinId: exitSig.coinId,
        quantity: exitSig.quantity,
        reason: exitSig.reason,
        confidence: 1,
        originalType: exitSig.exitType === 'TAKE_PROFIT' ? AlgoSignalType.TAKE_PROFIT : AlgoSignalType.STOP_LOSS,
        metadata: fullFidelity ? { ...exitSig.metadata, exitType: exitSig.exitType } : { exitType: exitSig.exitType }
      };

      if (fullFidelity) {
        opts.signals?.push({
          timestamp,
          signalType: SignalType.RISK_CONTROL,
          instrument: exitSig.coinId,
          direction: SignalDirection.SHORT,
          quantity: exitSig.quantity,
          price: exitSig.executionPrice,
          reason: exitSig.reason,
          confidence: 1,
          payload: exitSig.metadata,
          backtest: opts.backtest
        });
      }

      const dailyVolume = fullFidelity ? callbacks.extractDailyVolumeFn(priceMap, exitSig.coinId) : undefined;
      const spreadCtx = opts.prevCandleMap
        ? callbacks.buildSpreadContextFn(priceMap, exitSig.coinId, opts.prevCandleMap)
        : undefined;
      const tradeResult = await callbacks.executeTradeFn({
        signal: exitTradingSignal,
        portfolio,
        marketData,
        tradingFee,
        slippageConfig: opts.slippageConfig ?? DEFAULT_SLIPPAGE_CONFIG,
        dailyVolume,
        minHoldMs: 0, // bypass hold period for risk-control exits
        maxAllocation: opts.maxAllocation,
        minAllocation: opts.minAllocation,
        defaultLeverage: 1,
        spreadContext: spreadCtx
      });

      if (tradeResult) {
        const { trade, slippageBps, fillStatus } = tradeResult;
        if (fillStatus === SimulatedOrderStatus.CANCELLED) {
          if (fullFidelity) {
            opts.simulatedFills?.push({
              orderType: SimulatedOrderType.MARKET,
              status: SimulatedOrderStatus.CANCELLED,
              filledQuantity: 0,
              averagePrice: trade.price,
              fees: 0,
              slippageBps,
              executionTimestamp: timestamp,
              instrument: exitSig.coinId,
              metadata: {
                ...(trade.metadata ?? {}),
                exitType: exitSig.exitType,
                requestedQuantity: tradeResult.requestedQuantity
              },
              backtest: opts.backtest
            });
          }
        } else if (fullFidelity) {
          const baseCoin = opts.coinMap?.get(exitSig.coinId);
          trades.push({
            ...trade,
            executedAt: timestamp,
            backtest: opts.backtest,
            baseCoin: baseCoin || undefined,
            quoteCoin: opts.quoteCoin
          });
          opts.simulatedFills?.push({
            orderType: SimulatedOrderType.MARKET,
            status: fillStatus,
            filledQuantity: trade.quantity,
            averagePrice: trade.price,
            fees: trade.fee,
            slippageBps,
            executionTimestamp: timestamp,
            instrument: exitSig.coinId,
            metadata: { ...(trade.metadata ?? {}), exitType: exitSig.exitType },
            backtest: opts.backtest
          });
          exitTracker.removePosition(exitSig.coinId);
        } else {
          trades.push({ ...trade, executedAt: timestamp });
          exitTracker.removePosition(exitSig.coinId);
        }
      }
    }
  }

  /**
   * Convert portfolio positions to a holdings map suitable for snapshots.
   */
  portfolioToHoldings(
    portfolio: Portfolio,
    prices: Map<string, number>
  ): Record<string, { quantity: number; value: number; price: number }> {
    const holdings: Record<string, { quantity: number; value: number; price: number }> = {};
    for (const [coinId, position] of portfolio.positions) {
      const price = prices.get(coinId) ?? 0;
      holdings[coinId] = {
        quantity: position.quantity,
        value: new Decimal(position.quantity).times(price).toNumber(),
        price
      };
    }
    return holdings;
  }
}
