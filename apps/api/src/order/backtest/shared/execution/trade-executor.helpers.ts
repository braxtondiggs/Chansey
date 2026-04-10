/**
 * Pure helper functions for trade execution.
 *
 * Extracted from the TradeExecutorService to keep the service under 450 LOC.
 * These are stateless, side-effect-free functions that handle sizing math,
 * P&L calculation, side inference, and trade type determination.
 */

import { MAINTENANCE_MARGIN_RATE, MAX_LEVERAGE_CAP } from '@chansey/api-interfaces';

import { SignalType as AlgoSignalType } from '../../../../algorithm/interfaces';
import { BacktestTrade, TradeType } from '../../backtest-trade.entity';
import { SimulatedOrderStatus } from '../../simulated-order-fill.entity';
import { Portfolio } from '../portfolio';
import { SlippageConfig, SpreadEstimationContext } from '../slippage';
import { MarketData, TradingSignal } from '../types';

/** Default minimum hold period: 24 hours in milliseconds */
export const DEFAULT_MIN_HOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Calculate buy quantity from signal properties.
 * Priority: quantity > percentage > confidence > conservative fallback.
 */
export function calculateBuyQuantity(
  signal: TradingSignal,
  portfolioTotalValue: number,
  basePrice: number,
  maxAllocation: number,
  minAllocation: number
): { quantity: number; usedFallback: boolean } {
  if (signal.quantity) {
    return { quantity: signal.quantity, usedFallback: false };
  }
  if (signal.percentage) {
    const investmentAmount = portfolioTotalValue * signal.percentage;
    return { quantity: investmentAmount / basePrice, usedFallback: false };
  }
  if (signal.confidence !== undefined) {
    const confidenceBasedAllocation = minAllocation + signal.confidence * (maxAllocation - minAllocation);
    const investmentAmount = portfolioTotalValue * confidenceBasedAllocation;
    return { quantity: investmentAmount / basePrice, usedFallback: false };
  }
  // Conservative fallback
  const investmentAmount = portfolioTotalValue * minAllocation;
  return { quantity: investmentAmount / basePrice, usedFallback: true };
}

/**
 * Calculate sell quantity from signal properties.
 * Priority: quantity > percentage > confidence > 25% conservative fallback.
 */
export function calculateSellQuantity(
  signal: TradingSignal,
  existingQuantity: number
): { quantity: number; usedFallback: boolean } {
  let quantity: number;
  let usedFallback = false;

  if (signal.quantity) {
    quantity = signal.quantity;
  } else if (signal.percentage) {
    quantity = existingQuantity * Math.min(1, signal.percentage);
  } else if (signal.confidence !== undefined) {
    const confidenceBasedPercent = 0.25 + signal.confidence * 0.75;
    quantity = existingQuantity * confidenceBasedPercent;
  } else {
    quantity = existingQuantity * 0.25;
    usedFallback = true;
  }

  return { quantity: Math.min(quantity, existingQuantity), usedFallback };
}

/**
 * Resolve the effective leverage for a short position, clamped to [1, MAX_LEVERAGE_CAP].
 */
export function resolveShortLeverage(signal: TradingSignal, defaultLeverage: number): number {
  return Math.min(Math.max(1, (signal.metadata?.leverage as number) ?? defaultLeverage), MAX_LEVERAGE_CAP);
}

/**
 * Calculate the liquidation price for a short position.
 */
export function calculateShortLiquidationPrice(entryPrice: number, leverage: number): number {
  return entryPrice * (1 + 1 / leverage - MAINTENANCE_MARGIN_RATE);
}

/**
 * Calculate realized P&L for a long position close.
 *
 * Uses native floats intentionally (not Decimal.js) for backtest hot-loop
 * performance — these run millions of times per optimization sweep.
 * The precision loss is negligible for simulation P&L tracking.
 */
export function calculateLongPnL(
  exitPrice: number,
  costBasis: number,
  quantity: number
): { realizedPnL: number; realizedPnLPercent: number } {
  return {
    realizedPnL: (exitPrice - costBasis) * quantity,
    realizedPnLPercent: costBasis > 0 ? (exitPrice - costBasis) / costBasis : 0
  };
}

/**
 * Calculate realized P&L for a short position close (inverted from long).
 * Caps loss at the margin amount.
 */
export function calculateShortPnL(
  exitPrice: number,
  costBasis: number,
  quantity: number,
  returnedMargin: number
): { realizedPnL: number; realizedPnLPercent: number } {
  const rawPnL = (costBasis - exitPrice) * quantity;
  return {
    realizedPnL: Math.max(-returnedMargin, rawPnL),
    realizedPnLPercent: costBasis > 0 ? (costBasis - exitPrice) / costBasis : 0
  };
}

/**
 * Determine trade type from signal action.
 */
export function inferTradeType(action: TradingSignal['action']): TradeType {
  if (action === 'BUY' || action === 'OPEN_SHORT') {
    return TradeType.BUY;
  }
  return TradeType.SELL;
}

/**
 * Build a cancelled volume-rejection result.
 */
export function buildCancelledResult(
  price: number,
  slippageBps: number,
  requestedQuantity: number,
  reason: string | undefined
): ExecuteTradeResult {
  return {
    trade: {
      quantity: 0,
      price,
      metadata: { volumeRejection: true, reason }
    } as Partial<BacktestTrade>,
    slippageBps,
    fillStatus: SimulatedOrderStatus.CANCELLED,
    requestedQuantity
  };
}

/**
 * Determine whether a signal is a risk-control type that bypasses hold period checks.
 */
export function isRiskControlSignal(signal: TradingSignal): boolean {
  return signal.originalType === AlgoSignalType.STOP_LOSS || signal.originalType === AlgoSignalType.TAKE_PROFIT;
}

/**
 * Resolve the base execution price, accounting for hard stop-loss override.
 */
export function resolveBasePrice(signal: TradingSignal, marketPrice: number): number {
  return signal.metadata?.hardStopLoss && typeof signal.metadata?.stopExecutionPrice === 'number'
    ? signal.metadata.stopExecutionPrice
    : marketPrice;
}

/**
 * Result of executing a single trade.
 */
export interface ExecuteTradeResult {
  trade: Partial<BacktestTrade>;
  slippageBps: number;
  fillStatus: SimulatedOrderStatus;
  requestedQuantity?: number;
}

// ---------------------------------------------------------------------------
// Internal result types for action handlers
// ---------------------------------------------------------------------------

/**
 * Type guard to detect a cancelled volume-rejection result from action handlers.
 * Cancelled results have a `trade` property (from ExecuteTradeResult) whereas
 * internal action results (BuyResult, SellResult, etc.) do not.
 */
export function isCancelledResult(result: unknown): result is ExecuteTradeResult {
  return typeof result === 'object' && result !== null && 'trade' in result;
}

export interface BuyResult {
  quantity: number;
  totalValue: number;
  slippageBps: number;
  price: number;
  fillStatus: SimulatedOrderStatus;
  requestedQuantity?: number;
}

export interface SellResult extends BuyResult {
  realizedPnL: number;
  realizedPnLPercent: number;
  costBasis: number;
  holdTimeMs?: number;
}

export interface OpenShortResult extends BuyResult {
  positionSide: 'short';
  leverage: number;
  liquidationPrice: number;
  marginUsed: number;
}

export interface CloseShortResult extends BuyResult {
  realizedPnL: number;
  realizedPnLPercent: number;
  costBasis: number;
  positionSide: 'short';
  leverage?: number;
  liquidationPrice?: number;
  marginUsed: number;
}

/** Result from the shared slippage + fill assessment step. */
export interface SlippageFillResult {
  slippageBps: number;
  price: number;
  quantity: number;
  fillStatus: SimulatedOrderStatus;
  requestedQuantity?: number;
}

/** Shared context passed to all trade action handlers. */
export interface TradeContext {
  signal: TradingSignal;
  portfolio: Portfolio;
  basePrice: number;
  marketData: MarketData;
  tradingFee: number;
  slippageConfig: SlippageConfig;
  dailyVolume?: number;
  maxAllocation: number;
  minAllocation: number;
  minHoldMs: number;
  defaultLeverage: number;
  spreadContext?: SpreadEstimationContext;
}
