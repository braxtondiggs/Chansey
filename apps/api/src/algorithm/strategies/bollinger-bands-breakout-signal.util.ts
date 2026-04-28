import { type BollingerBreakoutConfig } from './bollinger-bands-breakout-config';

import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { type ChartDataPoint, SignalType, type TradingSignal } from '../interfaces';

/**
 * Check if breakout is confirmed over multiple bars.
 */
export function checkBollingerConfirmation(
  prices: CandleData[],
  upper: number[],
  lower: number[],
  config: BollingerBreakoutConfig,
  currentIndex: number
): { isConfirmed: boolean; direction: 'bullish' | 'bearish' | null } {
  let bullishCount = 0;
  let bearishCount = 0;

  for (let i = currentIndex - config.confirmationBars + 1; i <= currentIndex; i++) {
    if (i < 0 || !Number.isFinite(upper[i]) || !Number.isFinite(lower[i])) continue;

    const price = prices[i].avg;
    if (price > upper[i]) bullishCount++;
    if (price < lower[i]) bearishCount++;
  }

  if (bullishCount >= config.confirmationBars) {
    return { isConfirmed: true, direction: 'bullish' };
  }
  if (bearishCount >= config.confirmationBars) {
    return { isConfirmed: true, direction: 'bearish' };
  }

  return { isConfirmed: false, direction: null };
}

/**
 * Calculate signal strength based on %B distance from bands.
 */
export function calculateBollingerSignalStrength(percentB: number, direction: 'bullish' | 'bearish'): number {
  if (direction === 'bullish') {
    // %B > 1 means above upper band; higher %B = stronger breakout
    const excess = percentB - 1;
    return Math.min(1, Math.max(0.3, excess * 2));
  }
  // %B < 0 means below lower band; more negative = stronger breakdown
  const excess = Math.abs(percentB);
  return Math.min(1, Math.max(0.3, excess * 2));
}

/**
 * Calculate confidence based on bandwidth expansion and momentum consistency.
 */
export function calculateBollingerConfidence(
  pb: number[],
  bandwidth: number[],
  direction: 'bullish' | 'bearish',
  currentIndex: number
): number {
  const lookback = 5;
  const startIndex = Math.max(0, currentIndex - lookback);

  // Check if bandwidth is expanding (volatility increasing)
  let bandwidthExpanding = 0;
  for (let i = startIndex + 1; i <= currentIndex; i++) {
    if (Number.isFinite(bandwidth[i]) && Number.isFinite(bandwidth[i - 1]) && bandwidth[i] > bandwidth[i - 1]) {
      bandwidthExpanding++;
    }
  }

  // Check momentum consistency
  let momentumConsistent = 0;
  for (let i = startIndex + 1; i <= currentIndex; i++) {
    if (Number.isFinite(pb[i]) && Number.isFinite(pb[i - 1])) {
      if (direction === 'bullish' && pb[i] > pb[i - 1]) momentumConsistent++;
      if (direction === 'bearish' && pb[i] < pb[i - 1]) momentumConsistent++;
    }
  }

  const bandwidthScore = bandwidthExpanding / lookback;
  const momentumScore = momentumConsistent / lookback;

  return Math.min(1, (bandwidthScore + momentumScore) / 2 + 0.3);
}

/**
 * Generate trading signal based on Bollinger Bands breakout.
 */
export function generateBollingerBreakoutSignal(
  coinId: string,
  coinSymbol: string,
  prices: CandleData[],
  upper: number[],
  middle: number[],
  lower: number[],
  pb: number[],
  bandwidth: number[],
  config: BollingerBreakoutConfig
): TradingSignal | null {
  const currentIndex = prices.length - 1;

  if (
    !Number.isFinite(upper[currentIndex]) ||
    !Number.isFinite(lower[currentIndex]) ||
    !Number.isFinite(pb[currentIndex])
  ) {
    return null;
  }

  const currentPrice = prices[currentIndex].avg;
  const currentUpper = upper[currentIndex];
  const currentMiddle = middle[currentIndex];
  const currentLower = lower[currentIndex];
  const currentPB = pb[currentIndex]; // %B: 0 = at lower, 1 = at upper, >1 = above upper, <0 = below lower
  const currentBandwidth = bandwidth[currentIndex];

  // Check for confirmation if required
  if (config.requireConfirmation) {
    const confirmed = checkBollingerConfirmation(prices, upper, lower, config, currentIndex);
    if (!confirmed.isConfirmed) {
      return null;
    }
    // Only generate signal in the confirmed direction
    if (confirmed.direction === 'bullish' && !(currentPB > 1)) return null;
    if (confirmed.direction === 'bearish' && !(currentPB < 0)) return null;
  }

  // Squeeze filter: reject signals when bandwidth is too wide (not a squeeze breakout)
  const bwLookback = 20;
  const bwStart = Math.max(0, currentIndex - bwLookback);
  let bwSum = 0;
  let bwCount = 0;
  for (let i = bwStart; i < currentIndex; i++) {
    if (Number.isFinite(bandwidth[i])) {
      bwSum += bandwidth[i];
      bwCount++;
    }
  }
  const avgBandwidth = bwCount > 0 ? bwSum / bwCount : currentBandwidth;
  if (avgBandwidth > 0 && currentBandwidth > avgBandwidth * config.squeezeFactor) return null;

  if (config.requireConfirmation) {
    // Confirmation already validated sustained breakout — just check direction
    if (currentPB > 1) {
      return {
        type: SignalType.BUY,
        coinId,
        strength: calculateBollingerSignalStrength(currentPB, 'bullish'),
        price: currentPrice,
        confidence: calculateBollingerConfidence(pb, bandwidth, 'bullish', currentIndex),
        reason: `Bullish breakout: Price (${currentPrice.toFixed(2)}) broke above upper band (${currentUpper.toFixed(2)}), %B: ${currentPB.toFixed(2)}`,
        metadata: {
          symbol: coinSymbol,
          upperBand: currentUpper,
          middleBand: currentMiddle,
          lowerBand: currentLower,
          percentB: currentPB,
          bandwidth: currentBandwidth,
          breakoutType: 'bullish'
        }
      };
    }

    if (currentPB < 0) {
      return {
        type: SignalType.SELL,
        coinId,
        strength: calculateBollingerSignalStrength(currentPB, 'bearish'),
        price: currentPrice,
        confidence: calculateBollingerConfidence(pb, bandwidth, 'bearish', currentIndex),
        reason: `Bearish breakout: Price (${currentPrice.toFixed(2)}) broke below lower band (${currentLower.toFixed(2)}), %B: ${currentPB.toFixed(2)}`,
        metadata: {
          symbol: coinSymbol,
          upperBand: currentUpper,
          middleBand: currentMiddle,
          lowerBand: currentLower,
          percentB: currentPB,
          bandwidth: currentBandwidth,
          breakoutType: 'bearish'
        }
      };
    }
  } else {
    // No confirmation — require fresh transition from inside bands
    const prevPB = currentIndex > 0 && Number.isFinite(pb[currentIndex - 1]) ? pb[currentIndex - 1] : undefined;

    // Bullish breakout: Price TRANSITIONS from inside to above upper band
    if (currentPB > 1 && prevPB !== undefined && prevPB <= 1) {
      return {
        type: SignalType.BUY,
        coinId,
        strength: calculateBollingerSignalStrength(currentPB, 'bullish'),
        price: currentPrice,
        confidence: calculateBollingerConfidence(pb, bandwidth, 'bullish', currentIndex),
        reason: `Bullish breakout: Price (${currentPrice.toFixed(2)}) broke above upper band (${currentUpper.toFixed(2)}), %B: ${currentPB.toFixed(2)}`,
        metadata: {
          symbol: coinSymbol,
          upperBand: currentUpper,
          middleBand: currentMiddle,
          lowerBand: currentLower,
          percentB: currentPB,
          bandwidth: currentBandwidth,
          breakoutType: 'bullish'
        }
      };
    }

    // Bearish breakout: Price TRANSITIONS from inside to below lower band
    if (currentPB < 0 && prevPB !== undefined && prevPB >= 0) {
      return {
        type: SignalType.SELL,
        coinId,
        strength: calculateBollingerSignalStrength(currentPB, 'bearish'),
        price: currentPrice,
        confidence: calculateBollingerConfidence(pb, bandwidth, 'bearish', currentIndex),
        reason: `Bearish breakout: Price (${currentPrice.toFixed(2)}) broke below lower band (${currentLower.toFixed(2)}), %B: ${currentPB.toFixed(2)}`,
        metadata: {
          symbol: coinSymbol,
          upperBand: currentUpper,
          middleBand: currentMiddle,
          lowerBand: currentLower,
          percentB: currentPB,
          bandwidth: currentBandwidth,
          breakoutType: 'bearish'
        }
      };
    }
  }

  return null;
}

/**
 * Prepare chart data for visualization.
 */
export function prepareBollingerChartData(
  prices: CandleData[],
  upper: number[],
  middle: number[],
  lower: number[],
  pb: number[],
  bandwidth: number[]
): ChartDataPoint[] {
  return prices.map((price, index) => ({
    timestamp: price.date,
    value: price.avg,
    metadata: {
      upperBand: upper[index],
      middleBand: middle[index],
      lowerBand: lower[index],
      percentB: pb[index],
      bandwidth: bandwidth[index],
      high: price.high,
      low: price.low
    }
  }));
}
