import { Injectable } from '@nestjs/common';

import { LoopContext } from './backtest-loop-context';
import { classifySignalType } from './backtest-loop-runner.types';
import { TradeExecutorService } from './trade-executor.service';

import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { BacktestSignal, SignalDirection } from '../../backtest-signal.entity';
import { SimulatedOrderStatus, SimulatedOrderType } from '../../simulated-order-fill.entity';
import { OpportunitySellService } from '../opportunity-selling';
import { SlippageContextService } from '../slippage-context';
import { MarketData, TradingSignal } from '../types';

/**
 * Handles per-signal recording, trade execution, opportunity selling,
 * and exit tracker updates within a single bar iteration.
 *
 * Extracted from BacktestBarProcessor to keep both files under the 500-line limit.
 */
@Injectable()
export class BacktestSignalTradeService {
  constructor(
    private readonly tradeExecutor: TradeExecutorService,
    private readonly slippageCtxSvc: SlippageContextService,
    private readonly opportunitySellSvc: OpportunitySellService
  ) {}

  /**
   * Record signal, execute trade, handle opportunity selling, update exit tracker.
   */
  async processSignalTrade(
    ctx: LoopContext,
    strategySignal: TradingSignal,
    timestamp: Date,
    marketData: MarketData,
    currentPrices: OHLCCandle[],
    barMaxAllocation: number,
    barMinAllocation: number
  ): Promise<void> {
    const signalRecord: Partial<BacktestSignal> = {
      timestamp,
      signalType: classifySignalType(strategySignal),
      instrument: strategySignal.coinId,
      direction: this.resolveDirection(strategySignal),
      quantity: strategySignal.quantity ?? strategySignal.percentage ?? 0,
      price: marketData.prices.get(strategySignal.coinId),
      reason: strategySignal.reason,
      confidence: strategySignal.confidence,
      payload: {
        ...strategySignal.metadata,
        ...(strategySignal.exitConfig ? { strategyExitConfig: strategySignal.exitConfig } : {})
      },
      backtest: ctx.backtest
    };
    ctx.signals.push(signalRecord);

    const dailyVolume = this.slippageCtxSvc.extractDailyVolume(currentPrices, strategySignal.coinId);
    const spreadCtx = this.slippageCtxSvc.buildSpreadContext(currentPrices, strategySignal.coinId, ctx.prevCandleMap);

    let tradeResult = await this.tradeExecutor.executeTrade(
      strategySignal,
      ctx.portfolio,
      marketData,
      ctx.backtest.tradingFee,
      ctx.slippageConfig,
      dailyVolume,
      ctx.minHoldMs,
      barMaxAllocation,
      barMinAllocation,
      1,
      spreadCtx
    );

    // Opportunity selling: if BUY failed, attempt to sell positions to fund it
    if (!tradeResult && strategySignal.action === 'BUY' && ctx.oppSellingEnabled) {
      const oppResult = await this.opportunitySellSvc.attemptOpportunitySelling(
        strategySignal,
        ctx.portfolio,
        marketData,
        ctx.backtest.tradingFee,
        ctx.slippageConfig,
        ctx.oppSellingConfig,
        ctx.coinMap,
        ctx.quoteCoin,
        ctx.backtest,
        timestamp,
        ctx.trades,
        ctx.simulatedFills,
        this.tradeExecutor.executeTrade.bind(this.tradeExecutor),
        this.slippageCtxSvc.buildSpreadContext.bind(this.slippageCtxSvc),
        this.slippageCtxSvc.extractDailyVolume.bind(this.slippageCtxSvc),
        barMaxAllocation,
        barMinAllocation,
        currentPrices,
        ctx.prevCandleMap
      );

      if (oppResult) {
        tradeResult = await this.tradeExecutor.executeTrade(
          strategySignal,
          ctx.portfolio,
          marketData,
          ctx.backtest.tradingFee,
          ctx.slippageConfig,
          dailyVolume,
          ctx.minHoldMs,
          barMaxAllocation,
          barMinAllocation,
          1,
          spreadCtx
        );
      }
    }

    if (tradeResult) {
      this.recordTradeResult(ctx, tradeResult, strategySignal, timestamp);
    } else if (strategySignal.action === 'BUY') {
      ctx.metricsAcc.skippedBuyCount++;
    }
  }

  private recordTradeResult(
    ctx: LoopContext,
    tradeResult: NonNullable<Awaited<ReturnType<TradeExecutorService['executeTrade']>>>,
    strategySignal: TradingSignal,
    timestamp: Date
  ): void {
    const { trade, slippageBps, fillStatus } = tradeResult;

    if (fillStatus === SimulatedOrderStatus.CANCELLED) {
      ctx.simulatedFills.push({
        orderType: SimulatedOrderType.MARKET,
        status: SimulatedOrderStatus.CANCELLED,
        filledQuantity: 0,
        averagePrice: trade.price,
        fees: 0,
        slippageBps,
        executionTimestamp: timestamp,
        instrument: strategySignal.coinId,
        metadata: { ...trade.metadata, requestedQuantity: tradeResult.requestedQuantity },
        backtest: ctx.backtest
      });
      if (strategySignal.action === 'BUY') ctx.metricsAcc.skippedBuyCount++;
      return;
    }

    const baseCoin = ctx.coinMap.get(strategySignal.coinId);
    if (!baseCoin) {
      throw new Error(
        `baseCoin not found for coinId ${strategySignal.coinId}. Ensure all coins referenced by the algorithm are included in the backtest.`
      );
    }

    ctx.trades.push({ ...trade, executedAt: timestamp, backtest: ctx.backtest, baseCoin, quoteCoin: ctx.quoteCoin });
    ctx.simulatedFills.push({
      orderType: SimulatedOrderType.MARKET,
      status: fillStatus,
      filledQuantity: trade.quantity,
      averagePrice: trade.price,
      fees: trade.fee,
      slippageBps,
      executionTimestamp: timestamp,
      instrument: strategySignal.coinId,
      metadata: trade.metadata,
      backtest: ctx.backtest
    });

    // Update exit tracker: register new BUY positions, reduce on SELL
    if (ctx.exitTracker && trade.price != null && trade.quantity != null) {
      if (strategySignal.action === 'BUY') {
        ctx.exitTracker.onBuy(strategySignal.coinId, trade.price, trade.quantity, undefined, strategySignal.exitConfig);
      } else if (strategySignal.action === 'SELL') {
        ctx.exitTracker.onSell(strategySignal.coinId, trade.quantity);
      }
    }
  }

  private resolveDirection(signal: TradingSignal): SignalDirection {
    if (signal.action === 'BUY') return SignalDirection.LONG;
    if (signal.action === 'SELL' || signal.action === 'OPEN_SHORT' || signal.action === 'CLOSE_SHORT') {
      return SignalDirection.SHORT;
    }
    return SignalDirection.FLAT;
  }
}
