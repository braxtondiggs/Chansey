import { ATR } from 'technicalindicators';

import {
  type ExitConfig,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../../../interfaces/exit-config.interface';

/**
 * Default backtest exit configuration.
 * Matches legacy 5% hard stop-loss behavior (no TP, no trailing).
 */
export const DEFAULT_BACKTEST_EXIT_CONFIG: ExitConfig = {
  enableStopLoss: true,
  stopLossType: StopLossType.PERCENTAGE,
  stopLossValue: 5,

  enableTakeProfit: false,
  takeProfitType: TakeProfitType.RISK_REWARD,
  takeProfitValue: 2.0,

  atrPeriod: 14,
  atrMultiplier: 2.0,

  enableTrailingStop: false,
  trailingType: TrailingType.PERCENTAGE,
  trailingValue: 1.0,
  trailingActivation: TrailingActivationType.IMMEDIATE,

  useOco: false
};

/**
 * Calculate stop loss price from entry price and exit configuration.
 * Pure function — no side effects or dependencies.
 */
export function calculateStopLossPrice(
  entryPrice: number,
  side: 'BUY' | 'SELL',
  config: ExitConfig,
  currentAtr?: number
): number {
  let stopDistance: number;

  switch (config.stopLossType) {
    case StopLossType.FIXED:
      return config.stopLossValue;

    case StopLossType.PERCENTAGE:
      stopDistance = entryPrice * (config.stopLossValue / 100);
      break;

    case StopLossType.ATR:
      if (!currentAtr || isNaN(currentAtr)) {
        // Fallback to 2% if ATR not available
        stopDistance = entryPrice * 0.02;
      } else {
        stopDistance = currentAtr * config.stopLossValue;
      }
      break;

    default:
      stopDistance = entryPrice * 0.02;
  }

  // Long position: stop below entry, Short position: stop above entry
  return side === 'BUY' ? entryPrice - stopDistance : entryPrice + stopDistance;
}

/**
 * Calculate take profit price from entry price and exit configuration.
 * Pure function — no side effects or dependencies.
 */
export function calculateTakeProfitPrice(
  entryPrice: number,
  side: 'BUY' | 'SELL',
  config: ExitConfig,
  stopLossPrice?: number
): number {
  let profitDistance: number;

  switch (config.takeProfitType) {
    case TakeProfitType.FIXED:
      return config.takeProfitValue;

    case TakeProfitType.PERCENTAGE:
      profitDistance = entryPrice * (config.takeProfitValue / 100);
      break;

    case TakeProfitType.RISK_REWARD:
      if (!stopLossPrice) {
        // Fallback to 4% if no stop loss for R:R calculation
        profitDistance = entryPrice * 0.04;
      } else {
        const riskDistance = Math.abs(entryPrice - stopLossPrice);
        profitDistance = riskDistance * config.takeProfitValue;
      }
      break;

    default:
      profitDistance = entryPrice * 0.04;
  }

  // Long position: profit above entry, Short position: profit below entry
  return side === 'BUY' ? entryPrice + profitDistance : entryPrice - profitDistance;
}

/**
 * Calculate initial trailing stop price from entry price and exit configuration.
 * Pure function — no side effects or dependencies.
 */
export function calculateTrailingStopPrice(
  entryPrice: number,
  side: 'BUY' | 'SELL',
  config: ExitConfig,
  currentAtr?: number
): number {
  let trailingDistance: number;

  switch (config.trailingType) {
    case TrailingType.AMOUNT:
      trailingDistance = config.trailingValue;
      break;

    case TrailingType.PERCENTAGE:
      trailingDistance = entryPrice * (config.trailingValue / 100);
      break;

    case TrailingType.ATR:
      if (!currentAtr || isNaN(currentAtr)) {
        trailingDistance = entryPrice * 0.01; // 1% fallback
      } else {
        trailingDistance = currentAtr * config.trailingValue;
      }
      break;

    default:
      trailingDistance = entryPrice * 0.01;
  }

  return side === 'BUY' ? entryPrice - trailingDistance : entryPrice + trailingDistance;
}

/**
 * Calculate trailing stop activation price from entry price and exit configuration.
 * Pure function — no side effects or dependencies.
 */
export function calculateTrailingActivationPrice(entryPrice: number, side: 'BUY' | 'SELL', config: ExitConfig): number {
  switch (config.trailingActivation) {
    case TrailingActivationType.PRICE:
      return config.trailingActivationValue || entryPrice;

    case TrailingActivationType.PERCENTAGE: {
      const activationGain = entryPrice * ((config.trailingActivationValue || 1) / 100);
      return side === 'BUY' ? entryPrice + activationGain : entryPrice - activationGain;
    }

    default:
      // IMMEDIATE — activate from entry
      return entryPrice;
  }
}

/**
 * Compute ATR from raw OHLC arrays using `technicalindicators`.
 * Returns the most recent non-NaN ATR value, or undefined if insufficient data.
 */
export function computeAtrFromOHLC(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number | undefined {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return undefined;
  }

  try {
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period });
    // Walk backwards to find most recent non-NaN value
    for (let i = atrValues.length - 1; i >= 0; i--) {
      if (!isNaN(atrValues[i])) {
        return atrValues[i];
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
