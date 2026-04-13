import { type IndicatorSignal } from '../interfaces';

/**
 * Utility: Calculate average of valid (non-NaN) values in array slice
 * Uses absolute values if specified (for histogram normalization)
 */
export function calculateArrayAverage(
  values: number[],
  endIndex: number,
  lookback: number,
  useAbsolute = false
): { average: number; count: number } {
  let sum = 0;
  let count = 0;
  const startIndex = Math.max(0, endIndex - lookback);

  for (let i = startIndex; i <= endIndex; i++) {
    const value = values[i];
    if (Number.isFinite(value)) {
      sum += useAbsolute ? Math.abs(value) : value;
      count++;
    }
  }

  return {
    average: count > 0 ? sum / count : 0,
    count
  };
}

/**
 * EMA Trend Evaluation
 * Bullish: EMA12 > EMA26 (uptrend)
 * Bearish: EMA12 < EMA26 (downtrend)
 */
export function evaluateEMASignal(ema12: number[], ema26: number[], currentIndex: number): IndicatorSignal {
  const currentEma12 = ema12[currentIndex];
  const currentEma26 = ema26[currentIndex];
  const previousEma12 = ema12[currentIndex - 1];
  const previousEma26 = ema26[currentIndex - 1];

  if (!Number.isFinite(currentEma12) || !Number.isFinite(currentEma26)) {
    return {
      name: 'EMA',
      signal: 'neutral',
      strength: 0,
      reason: 'Insufficient data for EMA calculation',
      values: { ema12: currentEma12, ema26: currentEma26 }
    };
  }

  const spread = (currentEma12 - currentEma26) / currentEma26;
  const isCrossover =
    Number.isFinite(previousEma12) &&
    Number.isFinite(previousEma26) &&
    ((previousEma12 <= previousEma26 && currentEma12 > currentEma26) ||
      (previousEma12 >= previousEma26 && currentEma12 < currentEma26));

  // Strength based on spread magnitude and crossover
  const spreadStrength = Math.min(1, Math.abs(spread) * 20); // 5% spread = max
  const crossoverBonus = isCrossover ? 0.2 : 0;
  const strength = Math.min(1, spreadStrength + crossoverBonus);

  if (currentEma12 > currentEma26) {
    return {
      name: 'EMA',
      signal: 'bullish',
      strength,
      reason: `Bullish trend: EMA12 (${currentEma12.toFixed(2)}) > EMA26 (${currentEma26.toFixed(2)})`,
      values: { ema12: currentEma12, ema26: currentEma26, spread: spread * 100 }
    };
  } else {
    return {
      name: 'EMA',
      signal: 'bearish',
      strength,
      reason: `Bearish trend: EMA12 (${currentEma12.toFixed(2)}) < EMA26 (${currentEma26.toFixed(2)})`,
      values: { ema12: currentEma12, ema26: currentEma26, spread: spread * 100 }
    };
  }
}

/**
 * RSI Momentum Evaluation (trend-confirming mode)
 * Bullish: RSI > buyThreshold (strong upward momentum confirms trend)
 * Bearish: RSI < sellThreshold (weak momentum confirms downtrend)
 *
 * Note: Uses trend-confirming interpretation (RSI > threshold = bullish)
 * rather than mean-reversion (RSI < threshold = oversold = bullish),
 * so RSI agrees with trend-following indicators like EMA and MACD.
 */
export function evaluateRSISignal(
  rsi: number[],
  currentIndex: number,
  config: { buyThreshold: number; sellThreshold: number }
): IndicatorSignal {
  const currentRSI = rsi[currentIndex];

  if (!Number.isFinite(currentRSI)) {
    return {
      name: 'RSI',
      signal: 'neutral',
      strength: 0,
      reason: 'Insufficient data for RSI calculation',
      values: { rsi: currentRSI }
    };
  }

  // Trend-confirming: RSI above buy threshold confirms bullish momentum
  // RSI below sell threshold confirms bearish momentum
  if (currentRSI > config.buyThreshold) {
    const strength = (currentRSI - config.buyThreshold) / (100 - config.buyThreshold);
    return {
      name: 'RSI',
      signal: 'bullish',
      strength: Math.min(1, strength + 0.3),
      reason: `Bullish momentum: RSI (${currentRSI.toFixed(2)}) > ${config.buyThreshold} (strong upward momentum)`,
      values: { rsi: currentRSI, threshold: config.buyThreshold }
    };
  } else if (currentRSI < config.sellThreshold) {
    const strength = (config.sellThreshold - currentRSI) / config.sellThreshold;
    return {
      name: 'RSI',
      signal: 'bearish',
      strength: Math.min(1, strength + 0.3),
      reason: `Bearish momentum: RSI (${currentRSI.toFixed(2)}) < ${config.sellThreshold} (weak momentum)`,
      values: { rsi: currentRSI, threshold: config.sellThreshold }
    };
  } else {
    return {
      name: 'RSI',
      signal: 'neutral',
      strength: 0.3,
      reason: `Neutral momentum: RSI (${currentRSI.toFixed(2)}) in neutral zone`,
      values: { rsi: currentRSI }
    };
  }
}

/**
 * MACD Oscillator Evaluation
 * Bullish: MACD > Signal (positive histogram) AND positive momentum
 * Bearish: MACD < Signal (negative histogram) AND negative momentum
 *
 * @param avgHistogram Pre-calculated average histogram (absolute values) for normalization
 */
export function evaluateMACDSignal(
  macd: number[],
  signal: number[],
  histogram: number[],
  currentIndex: number,
  avgHistogram: number
): IndicatorSignal {
  const currentMACD = macd[currentIndex];
  const currentSignal = signal[currentIndex];
  const currentHistogram = histogram[currentIndex];
  const previousHistogram = histogram[currentIndex - 1];

  if (!Number.isFinite(currentMACD) || !Number.isFinite(currentSignal) || !Number.isFinite(currentHistogram)) {
    return {
      name: 'MACD',
      signal: 'neutral',
      strength: 0,
      reason: 'Insufficient data for MACD calculation',
      values: { macd: currentMACD, signal: currentSignal, histogram: currentHistogram }
    };
  }

  // Calculate histogram momentum (increasing or decreasing)
  const histogramMomentum = Number.isFinite(previousHistogram) ? currentHistogram - previousHistogram : 0;

  // Use pre-calculated average, fallback to current value if zero
  const effectiveAvg = avgHistogram > 0 ? avgHistogram : Math.abs(currentHistogram);
  const normalizedStrength = effectiveAvg > 0 ? Math.min(1, Math.abs(currentHistogram) / (effectiveAvg * 2)) : 0.5;

  // Momentum bonus: add strength if histogram direction and momentum agree
  const momentumBonus =
    (currentHistogram > 0 && histogramMomentum >= 0) || (currentHistogram < 0 && histogramMomentum <= 0) ? 0.15 : 0;

  if (currentHistogram > 0) {
    return {
      name: 'MACD',
      signal: 'bullish',
      strength: Math.min(1, normalizedStrength + 0.3 + momentumBonus),
      reason: `Bullish oscillator: MACD histogram positive (${currentHistogram.toFixed(4)})${histogramMomentum >= 0 ? ' with upward momentum' : ''}`,
      values: { macd: currentMACD, signal: currentSignal, histogram: currentHistogram }
    };
  } else if (currentHistogram < 0) {
    return {
      name: 'MACD',
      signal: 'bearish',
      strength: Math.min(1, normalizedStrength + 0.3 + momentumBonus),
      reason: `Bearish oscillator: MACD histogram negative (${currentHistogram.toFixed(4)})${histogramMomentum <= 0 ? ' with downward momentum' : ''}`,
      values: { macd: currentMACD, signal: currentSignal, histogram: currentHistogram }
    };
  } else {
    return {
      name: 'MACD',
      signal: 'neutral',
      strength: 0.3,
      reason: `Neutral oscillator: MACD histogram at zero`,
      values: { macd: currentMACD, signal: currentSignal, histogram: currentHistogram }
    };
  }
}

/**
 * ATR Volatility Filter Evaluation
 * Neutral: ATR <= average ATR * multiplier (allow signals)
 * Filtered: ATR > average ATR * multiplier (filter out signals - market too choppy)
 *
 * @param preCalculatedAvgATR Pre-calculated average ATR for efficiency
 */
export function evaluateATRSignal(
  atr: number[],
  currentIndex: number,
  config: { period: number; volatilityThresholdMultiplier: number },
  preCalculatedAvgATR: number
): IndicatorSignal {
  const currentATR = atr[currentIndex];

  if (!Number.isFinite(currentATR)) {
    return {
      name: 'ATR',
      signal: 'neutral',
      strength: 0.5,
      reason: 'Insufficient data for ATR calculation',
      values: { atr: currentATR }
    };
  }

  // Use pre-calculated average, fallback to current value if zero
  const avgATR = preCalculatedAvgATR > 0 ? preCalculatedAvgATR : currentATR;
  const volatilityRatio = avgATR > 0 ? currentATR / avgATR : 1;
  const threshold = config.volatilityThresholdMultiplier;

  if (volatilityRatio > threshold) {
    // High volatility - filter out signals
    return {
      name: 'ATR',
      signal: 'filtered',
      strength: 0,
      reason: `High volatility: ATR (${currentATR.toFixed(4)}) is ${(volatilityRatio * 100).toFixed(0)}% of average (threshold: ${(threshold * 100).toFixed(0)}%)`,
      values: { atr: currentATR, avgAtr: avgATR, ratio: volatilityRatio }
    };
  } else {
    // Normal volatility - allow signals with strength based on stability
    const stabilityStrength = 1 - volatilityRatio / threshold;
    return {
      name: 'ATR',
      signal: 'neutral', // ATR doesn't indicate direction, just filters
      strength: Math.max(0.4, stabilityStrength),
      reason: `Normal volatility: ATR (${currentATR.toFixed(4)}) is ${(volatilityRatio * 100).toFixed(0)}% of average`,
      values: { atr: currentATR, avgAtr: avgATR, ratio: volatilityRatio }
    };
  }
}

/**
 * Bollinger Bands Trend Evaluation (trend-confirming mode)
 * Bullish: %B > buyThreshold (price pushing toward upper band, strong uptrend)
 * Bearish: %B < sellThreshold (price pushing toward lower band, strong downtrend)
 *
 * Note: Uses trend-confirming interpretation (%B > threshold = bullish breakout)
 * rather than mean-reversion (%B < threshold = oversold = bullish),
 * so BB agrees with trend-following indicators like EMA and MACD.
 */
export function evaluateBollingerBandsSignal(
  pb: number[],
  bandwidth: number[],
  currentIndex: number,
  config: { buyThreshold: number; sellThreshold: number }
): IndicatorSignal {
  const currentPB = pb[currentIndex];
  const currentBandwidth = bandwidth[currentIndex];

  if (!Number.isFinite(currentPB) || !Number.isFinite(currentBandwidth)) {
    return {
      name: 'BB',
      signal: 'neutral',
      strength: 0,
      reason: 'Insufficient data for Bollinger Bands calculation',
      values: { percentB: currentPB, bandwidth: currentBandwidth }
    };
  }

  // Trend-confirming: %B above buy threshold = price pushing upper band = bullish breakout
  // %B below sell threshold = price pushing lower band = bearish breakdown
  if (currentPB > config.buyThreshold) {
    const strength = config.buyThreshold < 1 ? (currentPB - config.buyThreshold) / (1 - config.buyThreshold) : 0.5;
    return {
      name: 'BB',
      signal: 'bullish',
      strength: Math.min(1, strength + 0.4),
      reason: `Bullish breakout: %B (${currentPB.toFixed(2)}) > ${config.buyThreshold} (price pushing upper band)`,
      values: { percentB: currentPB, bandwidth: currentBandwidth, threshold: config.buyThreshold }
    };
  } else if (currentPB < config.sellThreshold) {
    const strength = config.sellThreshold > 0 ? (config.sellThreshold - currentPB) / config.sellThreshold : 0.5;
    return {
      name: 'BB',
      signal: 'bearish',
      strength: Math.min(1, strength + 0.4),
      reason: `Bearish breakdown: %B (${currentPB.toFixed(2)}) < ${config.sellThreshold} (price pushing lower band)`,
      values: { percentB: currentPB, bandwidth: currentBandwidth, threshold: config.sellThreshold }
    };
  } else {
    return {
      name: 'BB',
      signal: 'neutral',
      strength: 0.3,
      reason: `Neutral position: %B (${currentPB.toFixed(2)}) within bands`,
      values: { percentB: currentPB, bandwidth: currentBandwidth }
    };
  }
}
