import { MIN_RSI_DIVERGENCE, type RSIDivergenceConfig } from './rsi-divergence-config';

import { type CandleData } from '../../ohlc/ohlc-candle.entity';

export interface PivotPoint {
  index: number;
  price: number;
  rsi: number;
  type: 'high' | 'low';
}

export interface DivergenceResult {
  type: 'bullish' | 'bearish';
  pivot1: PivotPoint;
  pivot2: PivotPoint;
  priceDivergence: number;
  rsiDivergence: number;
  score: number;
}

/**
 * Find pivot highs using ATR-tolerant comparison.
 * Neighbors only need to be below (pivotHigh - ATR * tolerance), not strictly lower.
 */
export function findPivotHighs(
  prices: CandleData[],
  rsi: number[],
  atr: number[],
  tolerance: number,
  pivotStrength: number,
  startIndex: number,
  endIndex: number
): PivotPoint[] {
  const pivots: PivotPoint[] = [];

  for (let i = startIndex + pivotStrength; i <= endIndex - pivotStrength; i++) {
    if (!Number.isFinite(rsi[i]) || !Number.isFinite(atr[i]) || atr[i] <= 0) continue;

    const currentHigh = prices[i].high;
    const threshold = currentHigh - atr[i] * tolerance;
    let isPivot = true;

    for (let j = 1; j <= pivotStrength; j++) {
      if (prices[i - j].high > threshold || prices[i + j].high > threshold) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      pivots.push({ index: i, price: currentHigh, rsi: rsi[i], type: 'high' });
    }
  }

  return pivots;
}

/**
 * Find pivot lows using ATR-tolerant comparison.
 * Neighbors only need to be above (pivotLow + ATR * tolerance), not strictly higher.
 */
export function findPivotLows(
  prices: CandleData[],
  rsi: number[],
  atr: number[],
  tolerance: number,
  pivotStrength: number,
  startIndex: number,
  endIndex: number
): PivotPoint[] {
  const pivots: PivotPoint[] = [];

  for (let i = startIndex + pivotStrength; i <= endIndex - pivotStrength; i++) {
    if (!Number.isFinite(rsi[i]) || !Number.isFinite(atr[i]) || atr[i] <= 0) continue;

    const currentLow = prices[i].low;
    const threshold = currentLow + atr[i] * tolerance;
    let isPivot = true;

    for (let j = 1; j <= pivotStrength; j++) {
      if (prices[i - j].low < threshold || prices[i + j].low < threshold) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      pivots.push({ index: i, price: currentLow, rsi: rsi[i], type: 'low' });
    }
  }

  return pivots;
}

/**
 * Scan ALL pivot pairs and return the strongest divergence by combined magnitude.
 */
export function detectRSIDivergence(
  prices: CandleData[],
  rsi: number[],
  atr: number[],
  config: Pick<RSIDivergenceConfig, 'lookbackPeriod' | 'pivotStrength' | 'pivotTolerance' | 'minDivergencePercent'>
): DivergenceResult | null {
  const currentIndex = prices.length - 1;
  const lookbackStart = Math.max(0, currentIndex - config.lookbackPeriod - config.pivotStrength);
  const lookbackEnd = currentIndex;

  const pivotHighs = findPivotHighs(
    prices,
    rsi,
    atr,
    config.pivotTolerance,
    config.pivotStrength,
    lookbackStart,
    lookbackEnd
  );
  const pivotLows = findPivotLows(
    prices,
    rsi,
    atr,
    config.pivotTolerance,
    config.pivotStrength,
    lookbackStart,
    lookbackEnd
  );

  let best: DivergenceResult | null = null;

  // Scan all pivot high pairs for bearish divergence
  for (let i = 0; i < pivotHighs.length; i++) {
    for (let j = i + 1; j < pivotHighs.length; j++) {
      const p1 = pivotHighs[i];
      const p2 = pivotHighs[j];
      const priceDivergence = ((p2.price - p1.price) / p1.price) * 100;
      const rsiDivergence = p2.rsi - p1.rsi;

      if (priceDivergence >= config.minDivergencePercent && rsiDivergence <= -MIN_RSI_DIVERGENCE) {
        const score = Math.abs(priceDivergence) + Math.abs(rsiDivergence);
        if (!best || score > best.score) {
          best = { type: 'bearish', pivot1: p1, pivot2: p2, priceDivergence, rsiDivergence, score };
        }
      }
    }
  }

  // Scan all pivot low pairs for bullish divergence
  for (let i = 0; i < pivotLows.length; i++) {
    for (let j = i + 1; j < pivotLows.length; j++) {
      const p1 = pivotLows[i];
      const p2 = pivotLows[j];
      const priceDivergence = ((p2.price - p1.price) / p1.price) * 100;
      const rsiDivergence = p2.rsi - p1.rsi;

      if (priceDivergence <= -config.minDivergencePercent && rsiDivergence >= MIN_RSI_DIVERGENCE) {
        const score = Math.abs(priceDivergence) + Math.abs(rsiDivergence);
        if (!best || score > best.score) {
          best = { type: 'bullish', pivot1: p1, pivot2: p2, priceDivergence, rsiDivergence, score };
        }
      }
    }
  }

  return best;
}
