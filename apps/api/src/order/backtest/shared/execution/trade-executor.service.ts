import { Injectable, Logger } from '@nestjs/common';

import { getAllocationLimits } from '@chansey/api-interfaces';

import {
  buildCancelledResult,
  BuyResult,
  calculateBuyQuantity,
  calculateLongPnL,
  calculateSellQuantity,
  calculateShortLiquidationPrice,
  calculateShortPnL,
  CloseShortResult,
  DEFAULT_MIN_HOLD_MS,
  ExecuteTradeResult,
  inferTradeType,
  isCancelledResult,
  isRiskControlSignal,
  OpenShortResult,
  resolveBasePrice,
  resolveShortLeverage,
  SellResult,
  SlippageFillResult,
  TradeContext
} from './trade-executor.helpers';

import { BacktestTrade } from '../../backtest-trade.entity';
import { SimulatedOrderStatus } from '../../simulated-order-fill.entity';
import { FeeCalculatorService } from '../fees';
import { Portfolio, PortfolioStateService } from '../portfolio';
import { Position } from '../positions';
import { DEFAULT_SLIPPAGE_CONFIG, SlippageConfig, SlippageService, SpreadEstimationContext } from '../slippage';
import { ExecuteTradeParams, TradingSignal } from '../types';

/**
 * Trade Executor Service
 *
 * Executes individual trades against a portfolio, handling:
 * - Position sizing (BUY, SELL, OPEN_SHORT, CLOSE_SHORT)
 * - Slippage simulation
 * - Volume-aware fill assessment (partial fills, cancellations)
 * - Fee calculation
 * - Portfolio state mutations (cash balance, positions)
 * - Realized P&L tracking
 * - Minimum hold period enforcement
 * - Short position margin and liquidation price tracking
 */
@Injectable()
export class TradeExecutorService {
  private readonly logger = new Logger('TradeExecutorService');

  constructor(
    private readonly slippageService: SlippageService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly portfolioState: PortfolioStateService
  ) {}

  /**
   * Execute a single trade against the portfolio.
   *
   * Mutates the portfolio in-place (cash balance, positions, margin tracking).
   * Returns null if the trade cannot be executed (HOLD, no price, insufficient funds, etc.).
   */
  async executeTrade(params: ExecuteTradeParams): Promise<ExecuteTradeResult | null> {
    const {
      signal,
      portfolio,
      marketData,
      tradingFee,
      slippageConfig = DEFAULT_SLIPPAGE_CONFIG,
      dailyVolume,
      minHoldMs = DEFAULT_MIN_HOLD_MS,
      maxAllocation = getAllocationLimits().maxAllocation,
      minAllocation = getAllocationLimits().minAllocation,
      defaultLeverage = 1,
      spreadContext
    } = params;
    const marketPrice = marketData.prices.get(signal.coinId);
    if (!marketPrice) {
      this.logger.debug(`No price data available for coin ${signal.coinId}`);
      return null;
    }

    if (signal.action === 'HOLD') {
      return null;
    }

    if (!this.validatePositionConflicts(signal, portfolio)) {
      return null;
    }

    const basePrice = resolveBasePrice(signal, marketPrice);
    const ctx: TradeContext = {
      signal,
      portfolio,
      basePrice,
      marketData,
      tradingFee,
      slippageConfig,
      dailyVolume,
      maxAllocation,
      minAllocation,
      minHoldMs,
      defaultLeverage,
      spreadContext
    };

    let actionResult: BuyResult | SellResult | OpenShortResult | CloseShortResult;

    if (signal.action === 'BUY') {
      const r = this.executeBuy(ctx);
      if (!r) return null;
      if (isCancelledResult(r)) return r;
      actionResult = r;
    } else if (signal.action === 'SELL') {
      const r = this.executeSell(ctx);
      if (!r) return null;
      if (isCancelledResult(r)) return r;
      actionResult = r;
    } else if (signal.action === 'OPEN_SHORT') {
      const r = this.executeOpenShort(ctx);
      if (!r) return null;
      if (isCancelledResult(r)) return r;
      actionResult = r;
    } else {
      const r = this.executeCloseShort(ctx);
      if (!r) return null;
      if (isCancelledResult(r)) return r;
      actionResult = r;
    }

    // Fee base: use notional value for shorts, totalValue for longs
    const feeBaseValue =
      signal.action === 'OPEN_SHORT' || signal.action === 'CLOSE_SHORT'
        ? actionResult.quantity * actionResult.price
        : actionResult.totalValue;

    const feeConfig = this.feeCalculator.fromFlatRate(tradingFee);
    const feeResult = this.feeCalculator.calculateFee({ tradeValue: feeBaseValue }, feeConfig);
    const fee = feeResult.fee;
    portfolio.cashBalance -= fee;
    portfolio.totalValue =
      portfolio.cashBalance + this.portfolioState.calculatePositionsValue(portfolio.positions, marketData.prices);

    const tradeType = inferTradeType(signal.action);

    return {
      trade: {
        type: tradeType,
        quantity: actionResult.quantity,
        price: actionResult.price,
        totalValue: actionResult.totalValue,
        fee,
        realizedPnL: 'realizedPnL' in actionResult ? actionResult.realizedPnL : undefined,
        realizedPnLPercent: 'realizedPnLPercent' in actionResult ? actionResult.realizedPnLPercent : undefined,
        costBasis: 'costBasis' in actionResult ? actionResult.costBasis : undefined,
        positionSide: 'positionSide' in actionResult ? actionResult.positionSide : undefined,
        leverage: 'leverage' in actionResult ? actionResult.leverage : undefined,
        liquidationPrice: 'liquidationPrice' in actionResult ? actionResult.liquidationPrice : undefined,
        marginUsed: 'marginUsed' in actionResult ? actionResult.marginUsed : undefined,
        metadata: {
          ...(signal.metadata ?? {}),
          reason: signal.reason,
          confidence: signal.confidence ?? 0,
          basePrice,
          slippageBps: actionResult.slippageBps,
          ...('holdTimeMs' in actionResult &&
            actionResult.holdTimeMs !== undefined && { holdTimeMs: actionResult.holdTimeMs }),
          ...(actionResult.fillStatus === SimulatedOrderStatus.PARTIAL && {
            fillStatus: 'PARTIAL',
            requestedQuantity: actionResult.requestedQuantity
          })
        }
      } as Partial<BacktestTrade>,
      slippageBps: actionResult.slippageBps,
      fillStatus: actionResult.fillStatus,
      requestedQuantity: actionResult.requestedQuantity
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validatePositionConflicts(signal: TradingSignal, portfolio: Portfolio): boolean {
    if (signal.action === 'BUY') {
      const existing = portfolio.positions.get(signal.coinId);
      if (existing && existing.quantity > 0) {
        if (existing.side === 'short') {
          this.logger.debug(`Cannot buy ${signal.coinId}: short position already exists`);
        } else {
          this.logger.debug(`Skipped BUY for ${signal.coinId}: long position already held`);
        }
        return false;
      }
    }
    if (signal.action === 'OPEN_SHORT') {
      const existingLong = portfolio.positions.get(signal.coinId);
      if (existingLong && existingLong.side !== 'short' && existingLong.quantity > 0) {
        this.logger.debug(`Cannot open short for ${signal.coinId}: long position already exists`);
        return false;
      }
    }
    return true;
  }

  /**
   * Shared slippage calculation + volume-aware fill assessment.
   * Returns a SlippageFillResult on success, or an ExecuteTradeResult for CANCELLED fills.
   */
  private applySlippageAndFill(
    basePrice: number,
    quantity: number,
    isBuy: boolean,
    dailyVolume: number | undefined,
    slippageConfig: SlippageConfig,
    spreadContext?: SpreadEstimationContext,
    quantityCap?: number
  ): SlippageFillResult | ExecuteTradeResult {
    const slippageResult = this.slippageService.calculateSlippage(
      { price: basePrice, quantity, isBuy, dailyVolume, spreadContext },
      slippageConfig
    );
    const slippageBps = slippageResult.slippageBps;
    const price = slippageResult.executionPrice;

    const fillAssessment = this.slippageService.assessFillability(quantity * price, price, dailyVolume, slippageConfig);
    if (fillAssessment.fillStatus === 'CANCELLED') {
      return buildCancelledResult(price, slippageBps, quantity, fillAssessment.reason);
    }

    let fillStatus = SimulatedOrderStatus.FILLED;
    let requestedQuantity: number | undefined;
    let filledQuantity = quantity;
    if (fillAssessment.fillStatus === 'PARTIAL') {
      requestedQuantity = quantity;
      filledQuantity = quantityCap
        ? Math.min(fillAssessment.fillableQuantity, quantityCap)
        : fillAssessment.fillableQuantity;
      fillStatus = SimulatedOrderStatus.PARTIAL;
    }

    return { slippageBps, price, quantity: filledQuantity, fillStatus, requestedQuantity };
  }

  // ---------------------------------------------------------------------------
  // Private action handlers
  // ---------------------------------------------------------------------------

  private executeBuy(ctx: TradeContext): BuyResult | ExecuteTradeResult | null {
    const {
      signal,
      portfolio,
      basePrice,
      marketData,
      tradingFee,
      slippageConfig,
      dailyVolume,
      maxAllocation,
      minAllocation,
      spreadContext
    } = ctx;

    const { quantity: rawQuantity, usedFallback } = calculateBuyQuantity(
      signal,
      portfolio.totalValue,
      basePrice,
      maxAllocation,
      minAllocation
    );
    if (usedFallback) {
      this.logger.warn(
        `[POSITION_SIZING] Signal for ${signal.coinId} has no quantity, percentage, or confidence. ` +
          `Falling back to minAllocation (${minAllocation}). Fix the strategy to emit confidence.`
      );
    }

    const fillResult = this.applySlippageAndFill(
      basePrice,
      rawQuantity,
      true,
      dailyVolume,
      slippageConfig,
      spreadContext
    );
    if ('trade' in fillResult) return fillResult;
    const { slippageBps, price, quantity, fillStatus, requestedQuantity } = fillResult;

    const totalValue = quantity * price;
    const estimatedFeeResult = this.feeCalculator.calculateFee(
      { tradeValue: totalValue },
      this.feeCalculator.fromFlatRate(tradingFee)
    );

    if (portfolio.cashBalance < totalValue + estimatedFeeResult.fee) {
      this.logger.debug('Insufficient cash balance for BUY trade (including fees)');
      return null;
    }

    portfolio.cashBalance -= totalValue;

    const existingPosition = portfolio.positions.get(signal.coinId) ?? {
      coinId: signal.coinId,
      quantity: 0,
      averagePrice: 0,
      totalValue: 0
    };

    const newQuantity = existingPosition.quantity + quantity;
    existingPosition.averagePrice = existingPosition.quantity
      ? (existingPosition.averagePrice * existingPosition.quantity + price * quantity) / newQuantity
      : price;
    existingPosition.quantity = newQuantity;
    existingPosition.totalValue = existingPosition.quantity * price;

    if (!existingPosition.entryDate) {
      existingPosition.entryDate = marketData.timestamp;
    }

    portfolio.positions.set(signal.coinId, existingPosition);

    return { quantity, totalValue, slippageBps, price, fillStatus, requestedQuantity };
  }

  private executeSell(ctx: TradeContext): SellResult | ExecuteTradeResult | null {
    const { signal, portfolio, basePrice, marketData, slippageConfig, dailyVolume, minHoldMs, spreadContext } = ctx;

    const existingPosition = portfolio.positions.get(signal.coinId);
    if (!existingPosition || existingPosition.quantity === 0) {
      return null;
    }

    let holdTimeMs: number | undefined;
    if (existingPosition.entryDate) {
      holdTimeMs = marketData.timestamp.getTime() - existingPosition.entryDate.getTime();
    }

    if (!isRiskControlSignal(signal) && minHoldMs > 0 && holdTimeMs !== undefined && holdTimeMs < minHoldMs) {
      return null;
    }

    const costBasis = existingPosition.averagePrice;

    const { quantity: rawQuantity, usedFallback } = calculateSellQuantity(signal, existingPosition.quantity);
    if (usedFallback) {
      this.logger.warn(
        `[POSITION_SIZING] Signal for ${signal.coinId} has no quantity, percentage, or confidence. ` +
          `Falling back to 25% exit. Fix the strategy to emit confidence.`
      );
    }

    const fillResult = this.applySlippageAndFill(
      basePrice,
      rawQuantity,
      false,
      dailyVolume,
      slippageConfig,
      spreadContext,
      existingPosition.quantity
    );
    if ('trade' in fillResult) return fillResult;
    const { slippageBps, price, quantity, fillStatus, requestedQuantity } = fillResult;

    const totalValue = quantity * price;
    const { realizedPnL, realizedPnLPercent } = calculateLongPnL(price, costBasis, quantity);

    existingPosition.quantity -= quantity;
    existingPosition.totalValue = existingPosition.quantity * price;
    portfolio.cashBalance += totalValue;

    if (existingPosition.quantity === 0) {
      portfolio.positions.delete(signal.coinId);
    } else {
      portfolio.positions.set(signal.coinId, existingPosition);
    }

    return {
      quantity,
      totalValue,
      slippageBps,
      price,
      fillStatus,
      requestedQuantity,
      realizedPnL,
      realizedPnLPercent,
      costBasis,
      holdTimeMs
    };
  }

  private executeOpenShort(ctx: TradeContext): OpenShortResult | ExecuteTradeResult | null {
    const {
      signal,
      portfolio,
      basePrice,
      marketData,
      tradingFee,
      slippageConfig,
      dailyVolume,
      maxAllocation,
      minAllocation,
      defaultLeverage,
      spreadContext
    } = ctx;

    const shortLeverage = resolveShortLeverage(signal, defaultLeverage);

    const { quantity: rawQuantity, usedFallback } = calculateBuyQuantity(
      signal,
      portfolio.totalValue,
      basePrice,
      maxAllocation,
      minAllocation
    );
    if (usedFallback) {
      this.logger.warn(
        `[POSITION_SIZING] Signal for ${signal.coinId} has no quantity, percentage, or confidence. ` +
          `Falling back to minAllocation (${minAllocation}). Fix the strategy to emit confidence.`
      );
    }

    const fillResult = this.applySlippageAndFill(
      basePrice,
      rawQuantity,
      false,
      dailyVolume,
      slippageConfig,
      spreadContext
    );
    if ('trade' in fillResult) return fillResult;
    const { slippageBps, price, quantity, fillStatus, requestedQuantity } = fillResult;

    const marginAmount = (quantity * price) / shortLeverage;
    const totalValue = marginAmount;

    const estimatedFeeResult = this.feeCalculator.calculateFee(
      { tradeValue: quantity * price },
      this.feeCalculator.fromFlatRate(tradingFee)
    );

    if (portfolio.cashBalance < marginAmount + estimatedFeeResult.fee) {
      this.logger.debug('Insufficient cash balance for OPEN_SHORT trade (margin + fees)');
      return null;
    }

    portfolio.cashBalance -= marginAmount;

    const calcLiquidationPrice = calculateShortLiquidationPrice(price, shortLeverage);

    const shortPosition: Position = {
      coinId: signal.coinId,
      quantity,
      averagePrice: price,
      totalValue: marginAmount,
      side: 'short',
      leverage: shortLeverage,
      marginAmount,
      liquidationPrice: calcLiquidationPrice,
      entryDate: marketData.timestamp
    };

    portfolio.positions.set(signal.coinId, shortPosition);
    portfolio.totalMarginUsed = (portfolio.totalMarginUsed ?? 0) + marginAmount;
    portfolio.availableMargin = portfolio.cashBalance;

    return {
      quantity,
      totalValue,
      slippageBps,
      price,
      fillStatus,
      requestedQuantity,
      positionSide: 'short' as const,
      leverage: shortLeverage,
      liquidationPrice: calcLiquidationPrice,
      marginUsed: marginAmount
    };
  }

  private executeCloseShort(ctx: TradeContext): CloseShortResult | ExecuteTradeResult | null {
    const { signal, portfolio, basePrice, slippageConfig, dailyVolume, spreadContext } = ctx;

    const existingPosition = portfolio.positions.get(signal.coinId);
    if (!existingPosition || existingPosition.side !== 'short' || existingPosition.quantity === 0) {
      return null;
    }

    const costBasis = existingPosition.averagePrice;

    const { quantity: rawQuantity, usedFallback } = calculateSellQuantity(signal, existingPosition.quantity);
    if (usedFallback) {
      this.logger.warn(
        `[POSITION_SIZING] Signal for ${signal.coinId} has no quantity, percentage, or confidence. ` +
          `Falling back to 25% exit. Fix the strategy to emit confidence.`
      );
    }

    const fillResult = this.applySlippageAndFill(
      basePrice,
      rawQuantity,
      true,
      dailyVolume,
      slippageConfig,
      spreadContext,
      existingPosition.quantity
    );
    if ('trade' in fillResult) return fillResult;
    const { slippageBps, price, quantity, fillStatus, requestedQuantity } = fillResult;

    // Return margin proportionally
    const returnedMargin = (existingPosition.marginAmount ?? 0) * (quantity / existingPosition.quantity);
    const totalValue = returnedMargin;

    const { realizedPnL, realizedPnLPercent } = calculateShortPnL(price, costBasis, quantity, returnedMargin);

    portfolio.cashBalance += returnedMargin + realizedPnL;

    existingPosition.quantity -= quantity;
    if (existingPosition.quantity <= 0) {
      portfolio.positions.delete(signal.coinId);
    } else {
      const remainingMargin = (existingPosition.marginAmount ?? 0) - returnedMargin;
      existingPosition.marginAmount = remainingMargin;
      existingPosition.totalValue =
        remainingMargin + (existingPosition.averagePrice - price) * existingPosition.quantity;
      portfolio.positions.set(signal.coinId, existingPosition);
    }

    portfolio.totalMarginUsed = Math.max(0, (portfolio.totalMarginUsed ?? 0) - returnedMargin);
    portfolio.availableMargin = portfolio.cashBalance;

    return {
      quantity,
      totalValue,
      slippageBps,
      price,
      fillStatus,
      requestedQuantity,
      realizedPnL,
      realizedPnLPercent,
      costBasis,
      positionSide: 'short' as const,
      leverage: existingPosition.leverage,
      liquidationPrice: existingPosition.liquidationPrice,
      marginUsed: returnedMargin
    };
  }
}
