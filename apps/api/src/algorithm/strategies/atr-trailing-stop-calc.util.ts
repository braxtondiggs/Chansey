import { type ATRTrailingStopConfig, type Direction } from './atr-trailing-stop-config';

import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { type ChartDataPoint, SignalType, type TradingSignal } from '../interfaces';

export interface TrailingStopState {
  stopLevel: number;
  previousStopLevel: number;
  isTriggered: boolean;
  triggerType: 'stop_loss' | 'take_profit' | null;
}

/**
 * Find the extremum (highest high for long, lowest low for short) in a price range.
 */
export function findExtremum(
  prices: CandleData[],
  config: ATRTrailingStopConfig,
  direction: Direction,
  from: number,
  to: number
): number {
  const isLong = direction === 'long';
  let extremum = isLong ? -Infinity : Infinity;
  for (let i = from; i <= to; i++) {
    const value = config.useHighLow ? (isLong ? prices[i].high : prices[i].low) : prices[i].avg;
    if (isLong ? value > extremum : value < extremum) {
      extremum = value;
    }
  }
  return extremum;
}

/**
 * Calculate trailing stop level for a given direction.
 */
export function calculateTrailingStop(
  prices: CandleData[],
  atr: number[],
  config: ATRTrailingStopConfig,
  lookbackStart: number,
  currentIndex: number,
  direction: Direction
): TrailingStopState {
  const isLong = direction === 'long';
  const extremum = findExtremum(prices, config, direction, lookbackStart, currentIndex);

  const currentATR = atr[currentIndex];
  const currentPrice = config.useHighLow
    ? isLong
      ? prices[currentIndex].low
      : prices[currentIndex].high
    : prices[currentIndex].avg;
  const stopLevel = isLong
    ? extremum - currentATR * config.atrMultiplier
    : extremum + currentATR * config.atrMultiplier;

  // Calculate previous stop level for comparison
  const prevExtremum = findExtremum(prices, config, direction, lookbackStart, currentIndex - 1);
  const prevATR = Number.isFinite(atr[currentIndex - 1]) ? atr[currentIndex - 1] : currentATR;
  const previousStopLevel = isLong
    ? prevExtremum - prevATR * config.atrMultiplier
    : prevExtremum + prevATR * config.atrMultiplier;

  // Ratchet: trailing stop should only move in the favorable direction
  const ratchetedStopLevel = !Number.isFinite(previousStopLevel)
    ? stopLevel
    : isLong
      ? Math.max(stopLevel, previousStopLevel)
      : Math.min(stopLevel, previousStopLevel);

  const isTriggered = isLong ? currentPrice < ratchetedStopLevel : currentPrice > ratchetedStopLevel;

  return {
    stopLevel: ratchetedStopLevel,
    previousStopLevel,
    isTriggered,
    triggerType: isTriggered ? 'stop_loss' : null
  };
}

/**
 * Check if a stop was triggered on any of the previous N bars for this direction.
 * Prevents rapid re-entry after a stop loss fires.
 */
export function wasStopTriggeredRecently(
  prices: CandleData[],
  atr: number[],
  config: ATRTrailingStopConfig,
  direction: Direction,
  cooldownBars: number
): boolean {
  const currentIndex = prices.length - 1;
  // Start at i=2: bar N-1 is the trigger bar that legitimizes the trend-flip entry.
  // Looking at bars N-2 ... N-1-cooldownBars catches re-entry churn after older exits
  // without suppressing the very signal we're trying to fire.
  for (let i = 2; i <= cooldownBars + 1 && currentIndex - i >= config.atrPeriod; i++) {
    const barIndex = currentIndex - i;
    if (!Number.isFinite(atr[barIndex])) continue;
    const lookbackStart = Math.max(0, barIndex - config.atrPeriod);
    const state = calculateTrailingStop(prices, atr, config, lookbackStart, barIndex, direction);
    if (state.isTriggered) return true;
  }
  return false;
}

/**
 * Calculate ATR stability over a lookback period.
 * More stable ATR = more reliable signals.
 */
export function calculateAtrStability(atr: number[], currentIndex: number): { stability: number; valid: boolean } {
  const lookback = 5;
  const startIndex = Math.max(0, currentIndex - lookback);

  let atrSum = 0;
  let count = 0;
  for (let i = startIndex; i <= currentIndex; i++) {
    if (Number.isFinite(atr[i])) {
      atrSum += atr[i];
      count++;
    }
  }
  const avgATR = count > 0 ? atrSum / count : atr[currentIndex];

  if (!avgATR || avgATR === 0) return { stability: 0, valid: false };

  let atrVariation = 0;
  for (let i = startIndex; i <= currentIndex; i++) {
    if (Number.isFinite(atr[i])) {
      atrVariation += Math.abs(atr[i] - avgATR) / avgATR;
    }
  }

  return {
    stability: 1 - Math.min(1, count > 0 ? atrVariation / count : 0),
    valid: true
  };
}

export function calculateEntryStrength(currentPrice: number, stopLevel: number, atr: number): number {
  if (atr === 0) return 0.5;
  const buffer = Math.abs(currentPrice - stopLevel);
  const bufferRatio = buffer / atr;
  return Math.min(1, Math.max(0.3, bufferRatio * 0.5));
}

export function calculateEntryConfidence(atr: number[], currentIndex: number): number {
  const { stability, valid } = calculateAtrStability(atr, currentIndex);
  if (!valid) return 0.45;
  return Math.min(1, 0.45 + stability * 0.35);
}

export function calculateSignalStrength(currentPrice: number, stopLevel: number, atr: number): number {
  if (atr === 0) return 0.5;
  const breachAmount = Math.abs(currentPrice - stopLevel);
  const breachRatio = breachAmount / atr;
  return Math.min(1, Math.max(0.4, breachRatio));
}

export function calculateConfidence(
  _prices: CandleData[],
  atr: number[],
  stopState: TrailingStopState,
  direction: Direction
): number {
  // ATR array is chronologically ordered, so the last element is the most recent value.
  const currentIndex = atr.length - 1;
  const { stability, valid } = calculateAtrStability(atr, currentIndex);
  if (!valid) return 0.5;

  let stopProgression = 0;
  if (stopState.stopLevel > stopState.previousStopLevel && direction === 'long') {
    stopProgression = 0.2;
  } else if (stopState.stopLevel < stopState.previousStopLevel && direction === 'short') {
    stopProgression = 0.2;
  }

  return Math.min(1, 0.5 + stability * 0.3 + stopProgression);
}

export function prepareChartData(prices: CandleData[], atr: number[], config: ATRTrailingStopConfig): ChartDataPoint[] {
  return prices.map((price, index) => {
    let longStop: number | undefined;
    let shortStop: number | undefined;

    if (Number.isFinite(atr[index])) {
      const lookbackStart = Math.max(0, index - config.atrPeriod);
      const highestHigh = findExtremum(prices, config, 'long', lookbackStart, index);
      longStop = highestHigh - atr[index] * config.atrMultiplier;

      const lowestLow = findExtremum(prices, config, 'short', lookbackStart, index);
      shortStop = lowestLow + atr[index] * config.atrMultiplier;
    }

    return {
      timestamp: price.date,
      value: price.avg,
      metadata: {
        atr: atr[index],
        longTrailingStop: longStop,
        shortTrailingStop: shortStop,
        high: price.high,
        low: price.low
      }
    };
  });
}

/**
 * Generate stop signal for a given direction.
 */
export function generateStopSignal(
  coinId: string,
  coinSymbol: string,
  prices: CandleData[],
  atr: number[],
  config: ATRTrailingStopConfig,
  direction: Direction
): TradingSignal | null {
  const currentIndex = prices.length - 1;
  const lookbackStart = Math.max(0, currentIndex - config.atrPeriod);

  if (!Number.isFinite(atr[currentIndex])) return null;

  const stopState = calculateTrailingStop(prices, atr, config, lookbackStart, currentIndex, direction);
  const isLong = direction === 'long';
  const triggerPrice = config.useHighLow
    ? isLong
      ? prices[currentIndex].low
      : prices[currentIndex].high
    : prices[currentIndex].avg;
  const currentATR = atr[currentIndex];

  if (!stopState.isTriggered) return null;

  const strength = calculateSignalStrength(triggerPrice, stopState.stopLevel, currentATR);
  const confidence = calculateConfidence(prices, atr, stopState, direction);
  const action = isLong ? 'fell below' : 'rose above';

  return {
    type: SignalType.STOP_LOSS,
    coinId,
    strength,
    price: stopState.stopLevel,
    confidence,
    reason: `${isLong ? 'Long' : 'Short'} trailing stop triggered: Price (${triggerPrice.toFixed(2)}) ${action} stop (${stopState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
    metadata: {
      symbol: coinSymbol,
      currentPrice: triggerPrice,
      avgPrice: prices[currentIndex].avg,
      stopLevel: stopState.stopLevel,
      previousStopLevel: stopState.previousStopLevel,
      atr: currentATR,
      atrMultiplier: config.atrMultiplier,
      direction,
      stopType: 'trailing'
    }
  };
}

/**
 * Generate entry signal for a given direction based on trend-flip detection.
 * A trend flip occurs when the previous bar was triggered but the current bar is not.
 */
export function generateEntrySignal(
  coinId: string,
  coinSymbol: string,
  prices: CandleData[],
  atr: number[],
  config: ATRTrailingStopConfig,
  direction: Direction
): TradingSignal | null {
  const currentIndex = prices.length - 1;
  if (currentIndex < 1) return null;

  const lookbackStart = Math.max(0, currentIndex - config.atrPeriod);
  if (!Number.isFinite(atr[currentIndex]) || !Number.isFinite(atr[currentIndex - 1])) return null;

  const currentState = calculateTrailingStop(prices, atr, config, lookbackStart, currentIndex, direction);
  if (currentState.isTriggered) return null;

  const prevLookbackStart = Math.max(0, currentIndex - 1 - config.atrPeriod);
  const prevState = calculateTrailingStop(prices, atr, config, prevLookbackStart, currentIndex - 1, direction);
  if (!prevState.isTriggered) return null;

  const isLong = direction === 'long';
  const currentPrice = prices[currentIndex].avg;
  const currentATR = atr[currentIndex];
  const strength = calculateEntryStrength(currentPrice, currentState.stopLevel, currentATR);
  const confidence = calculateEntryConfidence(atr, currentIndex);
  const flipDesc = isLong ? 'Bullish trend flip detected. Price' : 'Bearish trend flip detected. Price';
  const action = isLong ? 'recovered above' : 'dropped below';

  return {
    type: isLong ? SignalType.BUY : SignalType.SELL,
    coinId,
    strength,
    price: currentPrice,
    confidence,
    reason: `${isLong ? 'Long' : 'Short'} entry: ${flipDesc} (${currentPrice.toFixed(2)}) ${action} trailing stop (${currentState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
    metadata: {
      symbol: coinSymbol,
      currentPrice,
      stopLevel: currentState.stopLevel,
      atr: currentATR,
      atrMultiplier: config.atrMultiplier,
      direction,
      signalSource: 'trend_flip'
    }
  };
}
