import { type TripleEMAConfig } from './triple-ema-config';

import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { type ChartDataPoint, SignalType, type TradingSignal } from '../interfaces';

export type EMAAlignment = 'bullish' | 'bearish' | 'neutral';

export interface AlignmentState {
  current: EMAAlignment;
  previous: EMAAlignment;
  fastAboveMedium: boolean;
  mediumAboveSlow: boolean;
  fastAboveSlow: boolean;
  emaSpread: number;
}

/**
 * Determine EMA alignment at a specific index
 */
export function getAlignment(fastEMA: number, mediumEMA: number, slowEMA: number): EMAAlignment {
  if (fastEMA > mediumEMA && mediumEMA > slowEMA) {
    return 'bullish';
  } else if (fastEMA < mediumEMA && mediumEMA < slowEMA) {
    return 'bearish';
  }
  return 'neutral';
}

/**
 * Analyze alignment state at current and previous bar
 */
export function analyzeAlignmentState(
  fastEMA: number[],
  mediumEMA: number[],
  slowEMA: number[],
  currentIndex: number
): AlignmentState | null {
  const previousIndex = currentIndex - 1;

  if (
    previousIndex < 0 ||
    !Number.isFinite(fastEMA[currentIndex]) ||
    !Number.isFinite(mediumEMA[currentIndex]) ||
    !Number.isFinite(slowEMA[currentIndex]) ||
    !Number.isFinite(fastEMA[previousIndex]) ||
    !Number.isFinite(mediumEMA[previousIndex]) ||
    !Number.isFinite(slowEMA[previousIndex])
  ) {
    return null;
  }

  const currentFast = fastEMA[currentIndex];
  const currentMedium = mediumEMA[currentIndex];
  const currentSlow = slowEMA[currentIndex];
  const previousFast = fastEMA[previousIndex];
  const previousMedium = mediumEMA[previousIndex];
  const previousSlow = slowEMA[previousIndex];

  const currentAlignment = getAlignment(currentFast, currentMedium, currentSlow);
  const previousAlignment = getAlignment(previousFast, previousMedium, previousSlow);

  // Calculate EMA spread (distance between fast and slow as percentage of slow)
  const emaSpread = Math.abs(currentFast - currentSlow) / currentSlow;

  return {
    current: currentAlignment,
    previous: previousAlignment,
    fastAboveMedium: currentFast > currentMedium,
    mediumAboveSlow: currentMedium > currentSlow,
    fastAboveSlow: currentFast > currentSlow,
    emaSpread
  };
}

/**
 * Calculate signal strength based on EMA spread
 */
export function calculateSignalStrength(alignmentState: AlignmentState): number {
  // Larger EMA spread indicates stronger trend
  const spreadStrength = Math.min(1, alignmentState.emaSpread * 10); // 10% spread = max strength

  // Full alignment gives higher base strength
  const alignmentStrength = alignmentState.current !== 'neutral' ? 0.5 : 0.3;

  return Math.min(1, Math.max(0.4, alignmentStrength + spreadStrength * 0.5));
}

/**
 * Calculate confidence based on EMA spread velocity (rate of divergence)
 */
export function calculateConfidence(
  fastEMA: number[],
  _mediumEMA: number[],
  slowEMA: number[],
  alignmentState: AlignmentState,
  currentIndex: number,
  _isBullish: boolean
): number {
  // Measure rate of EMA divergence instead of pre-signal alignment
  const velocityLookback = Math.min(5, currentIndex);
  let spreadVelocity = 0;
  let velocityCount = 0;
  for (let i = currentIndex - velocityLookback + 1; i <= currentIndex; i++) {
    if (
      i < 1 ||
      !Number.isFinite(fastEMA[i]) ||
      !Number.isFinite(slowEMA[i]) ||
      !Number.isFinite(fastEMA[i - 1]) ||
      !Number.isFinite(slowEMA[i - 1])
    )
      continue;
    const curSpread = (fastEMA[i] - slowEMA[i]) / slowEMA[i];
    const prevSpread = (fastEMA[i - 1] - slowEMA[i - 1]) / slowEMA[i - 1];
    spreadVelocity += Math.abs(curSpread) - Math.abs(prevSpread);
    velocityCount++;
  }
  const avgVelocity = velocityCount > 0 ? spreadVelocity / velocityCount : 0;
  const velocityScore = Math.min(1, Math.max(0, avgVelocity * 200));
  const spreadScore = Math.min(1, alignmentState.emaSpread * 8);
  return Math.min(1, 0.4 + velocityScore * 0.3 + spreadScore * 0.3);
}

/**
 * Generate trading signal based on EMA alignment changes
 */
export function generateTripleEMASignal(
  coinId: string,
  coinSymbol: string,
  prices: CandleData[],
  fastEMA: number[],
  mediumEMA: number[],
  slowEMA: number[],
  config: TripleEMAConfig
): TradingSignal | null {
  const currentIndex = prices.length - 1;
  const alignmentState = analyzeAlignmentState(fastEMA, mediumEMA, slowEMA, currentIndex);

  if (!alignmentState) {
    return null;
  }

  const currentPrice = prices[currentIndex].avg;
  const currentFast = fastEMA[currentIndex];
  const currentMedium = mediumEMA[currentIndex];
  const currentSlow = slowEMA[currentIndex];

  // Check for alignment change (strongest signal)
  if (alignmentState.current !== alignmentState.previous) {
    if (alignmentState.current === 'bullish' && alignmentState.emaSpread >= config.minSpread) {
      // Transition to bullish alignment
      const strength = calculateSignalStrength(alignmentState);
      const confidence = calculateConfidence(fastEMA, mediumEMA, slowEMA, alignmentState, currentIndex, true);

      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Triple EMA bullish alignment: Fast EMA (${currentFast.toFixed(4)}) > Medium EMA (${currentMedium.toFixed(4)}) > Slow EMA (${currentSlow.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          fastEMA: currentFast,
          mediumEMA: currentMedium,
          slowEMA: currentSlow,
          alignment: 'bullish',
          previousAlignment: alignmentState.previous,
          emaSpread: alignmentState.emaSpread,
          alignmentType: 'full'
        }
      };
    }

    if (alignmentState.current === 'bearish' && alignmentState.emaSpread >= config.minSpread) {
      // Transition to bearish alignment
      const strength = calculateSignalStrength(alignmentState);
      const confidence = calculateConfidence(fastEMA, mediumEMA, slowEMA, alignmentState, currentIndex, false);

      return {
        type: SignalType.SELL,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Triple EMA bearish alignment: Fast EMA (${currentFast.toFixed(4)}) < Medium EMA (${currentMedium.toFixed(4)}) < Slow EMA (${currentSlow.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          fastEMA: currentFast,
          mediumEMA: currentMedium,
          slowEMA: currentSlow,
          alignment: 'bearish',
          previousAlignment: alignmentState.previous,
          emaSpread: alignmentState.emaSpread,
          alignmentType: 'full'
        }
      };
    }

    // Breakdown: alignment lost — exit signal (bypasses minSpread since converging EMAs ARE the signal)
    if (alignmentState.current === 'neutral') {
      if (alignmentState.previous === 'bullish') {
        const strength = Math.max(0.7, calculateSignalStrength(alignmentState));

        return {
          type: SignalType.SELL,
          coinId,
          strength,
          price: currentPrice,
          confidence: Math.max(0.7, config.minConfidence),
          reason: `Triple EMA breakdown: Bullish alignment lost — Fast > Medium > Slow no longer holds (Fast: ${currentFast.toFixed(4)}, Medium: ${currentMedium.toFixed(4)}, Slow: ${currentSlow.toFixed(4)})`,
          metadata: {
            symbol: coinSymbol,
            fastEMA: currentFast,
            mediumEMA: currentMedium,
            slowEMA: currentSlow,
            alignment: 'neutral',
            previousAlignment: 'bullish',
            emaSpread: alignmentState.emaSpread,
            alignmentType: 'breakdown'
          }
        };
      }

      if (alignmentState.previous === 'bearish') {
        const strength = Math.max(0.7, calculateSignalStrength(alignmentState));

        return {
          type: SignalType.BUY,
          coinId,
          strength,
          price: currentPrice,
          confidence: Math.max(0.7, config.minConfidence),
          reason: `Triple EMA breakdown: Bearish alignment lost — Fast < Medium < Slow no longer holds (Fast: ${currentFast.toFixed(4)}, Medium: ${currentMedium.toFixed(4)}, Slow: ${currentSlow.toFixed(4)})`,
          metadata: {
            symbol: coinSymbol,
            fastEMA: currentFast,
            mediumEMA: currentMedium,
            slowEMA: currentSlow,
            alignment: 'neutral',
            previousAlignment: 'bearish',
            emaSpread: alignmentState.emaSpread,
            alignmentType: 'breakdown'
          }
        };
      }
    }
  }

  // Minimum EMA spread filter for partial cross signals
  if (alignmentState.emaSpread < config.minSpread) {
    return null;
  }

  // Optional: Signal on partial crossover (fast/medium cross while medium/slow aligned)
  if (config.signalOnPartialCross && !config.requireFullAlignment) {
    const prevFastAboveMedium = fastEMA[currentIndex - 1] > mediumEMA[currentIndex - 1];
    const fastMediumCrossover = alignmentState.fastAboveMedium !== prevFastAboveMedium;

    if (fastMediumCrossover && alignmentState.mediumAboveSlow && alignmentState.fastAboveMedium) {
      // Fast crossed above medium while medium > slow (bullish partial)
      const strength = calculateSignalStrength(alignmentState) * 0.7;
      const confidence = calculateConfidence(fastEMA, mediumEMA, slowEMA, alignmentState, currentIndex, true) * 0.8;

      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Triple EMA partial bullish: Fast EMA crossed above Medium EMA while trend is up`,
        metadata: {
          symbol: coinSymbol,
          fastEMA: currentFast,
          mediumEMA: currentMedium,
          slowEMA: currentSlow,
          alignment: alignmentState.current,
          emaSpread: alignmentState.emaSpread,
          alignmentType: 'partial'
        }
      };
    }

    if (fastMediumCrossover && !alignmentState.mediumAboveSlow && !alignmentState.fastAboveMedium) {
      // Fast crossed below medium while medium < slow (bearish partial)
      const strength = calculateSignalStrength(alignmentState) * 0.7;
      const confidence = calculateConfidence(fastEMA, mediumEMA, slowEMA, alignmentState, currentIndex, false) * 0.8;

      return {
        type: SignalType.SELL,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Triple EMA partial bearish: Fast EMA crossed below Medium EMA while trend is down`,
        metadata: {
          symbol: coinSymbol,
          fastEMA: currentFast,
          mediumEMA: currentMedium,
          slowEMA: currentSlow,
          alignment: alignmentState.current,
          emaSpread: alignmentState.emaSpread,
          alignmentType: 'partial'
        }
      };
    }
  }

  return null;
}

/**
 * Prepare chart data for visualization
 */
export function prepareTripleEMAChartData(
  prices: CandleData[],
  fastEMA: number[],
  mediumEMA: number[],
  slowEMA: number[]
): ChartDataPoint[] {
  return prices.map((price, index) => {
    const alignment =
      Number.isFinite(fastEMA[index]) && Number.isFinite(mediumEMA[index]) && Number.isFinite(slowEMA[index])
        ? getAlignment(fastEMA[index], mediumEMA[index], slowEMA[index])
        : 'neutral';

    return {
      timestamp: price.date,
      value: price.avg,
      metadata: {
        fastEMA: fastEMA[index],
        mediumEMA: mediumEMA[index],
        slowEMA: slowEMA[index],
        alignment,
        high: price.high,
        low: price.low
      }
    };
  });
}
