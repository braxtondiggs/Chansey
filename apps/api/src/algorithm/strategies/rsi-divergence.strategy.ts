import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface RSIDivergenceConfig {
  rsiPeriod: number;
  lookbackPeriod: number;
  pivotStrength: number;
  minDivergencePercent: number;
  minConfidence: number;
}

interface PivotPoint {
  index: number;
  price: number;
  rsi: number;
  type: 'high' | 'low';
}

interface DivergenceResult {
  type: 'bullish' | 'bearish';
  pivot1: PivotPoint;
  pivot2: PivotPoint;
  priceDivergence: number;
  rsiDivergence: number;
}

/**
 * RSI Divergence Strategy
 *
 * Detects divergence between price action and RSI indicator.
 * Bullish divergence: Price makes lower lows while RSI makes higher lows (potential reversal up)
 * Bearish divergence: Price makes higher highs while RSI makes lower highs (potential reversal down)
 *
 * Divergence signals are considered strong reversal indicators.
 *
 * Uses centralized IndicatorService for RSI calculations with caching.
 */
@Injectable()
export class RSIDivergenceStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'rsi-divergence-001';

  constructor(
    schedulerRegistry: SchedulerRegistry,
    private readonly indicatorService: IndicatorService
  ) {
    super(schedulerRegistry);
  }

  /**
   * Optional: Provide custom calculator override for specific indicators
   */
  getCustomCalculator<T extends keyof IndicatorCalculatorMap>(
    _indicatorType: T
  ): IndicatorCalculatorMap[T] | undefined {
    return undefined;
  }

  /**
   * Execute the RSI Divergence strategy
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      const config = this.getConfigWithDefaults(context.config);

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, config)) {
          this.logger.warn(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate RSI using IndicatorService (with caching)
        const rsiResult = await this.indicatorService.calculateRSI(
          { coinId: coin.id, prices: priceHistory, period: config.rsiPeriod },
          this
        );

        const rsi = rsiResult.values;

        // Detect divergences
        const divergence = this.detectDivergence(priceHistory, rsi, config);

        if (divergence) {
          const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, rsi, divergence, config);
          if (signal && signal.confidence >= config.minConfidence) {
            signals.push(signal);
          }
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, rsi, config);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`RSI Divergence strategy execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): RSIDivergenceConfig {
    return {
      rsiPeriod: (config.rsiPeriod as number) || 14,
      lookbackPeriod: (config.lookbackPeriod as number) || 14,
      pivotStrength: (config.pivotStrength as number) || 2,
      minDivergencePercent: (config.minDivergencePercent as number) || 5,
      minConfidence: (config.minConfidence as number) || 0.6
    };
  }

  /**
   * Check if we have enough data for RSI divergence detection
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: RSIDivergenceConfig): boolean {
    const minRequired = config.rsiPeriod + config.lookbackPeriod + config.pivotStrength * 2;
    return !!priceHistory && priceHistory.length >= minRequired;
  }

  /**
   * Find pivot highs (local maxima)
   */
  private findPivotHighs(
    prices: PriceSummary[],
    rsi: number[],
    strength: number,
    startIndex: number,
    endIndex: number
  ): PivotPoint[] {
    const pivots: PivotPoint[] = [];

    for (let i = startIndex + strength; i <= endIndex - strength; i++) {
      if (isNaN(rsi[i])) continue;

      let isPivotHigh = true;
      const currentPrice = prices[i].high;

      // Check if current point is higher than 'strength' bars on each side
      for (let j = 1; j <= strength; j++) {
        if (prices[i - j].high >= currentPrice || prices[i + j].high >= currentPrice) {
          isPivotHigh = false;
          break;
        }
      }

      if (isPivotHigh) {
        pivots.push({
          index: i,
          price: currentPrice,
          rsi: rsi[i],
          type: 'high'
        });
      }
    }

    return pivots;
  }

  /**
   * Find pivot lows (local minima)
   */
  private findPivotLows(
    prices: PriceSummary[],
    rsi: number[],
    strength: number,
    startIndex: number,
    endIndex: number
  ): PivotPoint[] {
    const pivots: PivotPoint[] = [];

    for (let i = startIndex + strength; i <= endIndex - strength; i++) {
      if (isNaN(rsi[i])) continue;

      let isPivotLow = true;
      const currentPrice = prices[i].low;

      // Check if current point is lower than 'strength' bars on each side
      for (let j = 1; j <= strength; j++) {
        if (prices[i - j].low <= currentPrice || prices[i + j].low <= currentPrice) {
          isPivotLow = false;
          break;
        }
      }

      if (isPivotLow) {
        pivots.push({
          index: i,
          price: currentPrice,
          rsi: rsi[i],
          type: 'low'
        });
      }
    }

    return pivots;
  }

  /**
   * Detect bullish or bearish divergence
   */
  private detectDivergence(
    prices: PriceSummary[],
    rsi: number[],
    config: RSIDivergenceConfig
  ): DivergenceResult | null {
    const currentIndex = prices.length - 1;
    const lookbackStart = Math.max(0, currentIndex - config.lookbackPeriod - config.pivotStrength);
    const lookbackEnd = currentIndex - config.pivotStrength; // Need room for pivot confirmation

    // Find pivot highs for bearish divergence detection
    const pivotHighs = this.findPivotHighs(prices, rsi, config.pivotStrength, lookbackStart, lookbackEnd);

    // Find pivot lows for bullish divergence detection
    const pivotLows = this.findPivotLows(prices, rsi, config.pivotStrength, lookbackStart, lookbackEnd);

    // Check for bearish divergence (price higher highs, RSI lower highs)
    if (pivotHighs.length >= 2) {
      // Get the two most recent pivot highs
      const recentHighs = pivotHighs.slice(-2);
      const [pivot1, pivot2] = recentHighs;

      const priceDivergence = ((pivot2.price - pivot1.price) / pivot1.price) * 100;
      const rsiDivergence = pivot2.rsi - pivot1.rsi;

      // Bearish: Price making higher highs but RSI making lower highs
      if (priceDivergence >= config.minDivergencePercent && rsiDivergence < 0) {
        return {
          type: 'bearish',
          pivot1,
          pivot2,
          priceDivergence,
          rsiDivergence
        };
      }
    }

    // Check for bullish divergence (price lower lows, RSI higher lows)
    if (pivotLows.length >= 2) {
      // Get the two most recent pivot lows
      const recentLows = pivotLows.slice(-2);
      const [pivot1, pivot2] = recentLows;

      const priceDivergence = ((pivot2.price - pivot1.price) / pivot1.price) * 100;
      const rsiDivergence = pivot2.rsi - pivot1.rsi;

      // Bullish: Price making lower lows but RSI making higher lows
      if (priceDivergence <= -config.minDivergencePercent && rsiDivergence > 0) {
        return {
          type: 'bullish',
          pivot1,
          pivot2,
          priceDivergence,
          rsiDivergence
        };
      }
    }

    return null;
  }

  /**
   * Generate trading signal based on detected divergence
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    rsi: number[],
    divergence: DivergenceResult,
    config: RSIDivergenceConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const currentPrice = prices[currentIndex].avg;
    const currentRSI = rsi[currentIndex];

    const strength = this.calculateSignalStrength(divergence, config);
    const confidence = this.calculateConfidence(prices, rsi, divergence, config);

    if (divergence.type === 'bullish') {
      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Bullish RSI divergence: Price made lower low (${divergence.priceDivergence.toFixed(2)}%) while RSI made higher low (+${divergence.rsiDivergence.toFixed(2)} points)`,
        metadata: {
          symbol: coinSymbol,
          divergenceType: 'bullish',
          currentRSI,
          pivot1Index: divergence.pivot1.index,
          pivot1Price: divergence.pivot1.price,
          pivot1RSI: divergence.pivot1.rsi,
          pivot2Index: divergence.pivot2.index,
          pivot2Price: divergence.pivot2.price,
          pivot2RSI: divergence.pivot2.rsi,
          priceDivergence: divergence.priceDivergence,
          rsiDivergence: divergence.rsiDivergence
        }
      };
    } else {
      return {
        type: SignalType.SELL,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Bearish RSI divergence: Price made higher high (+${divergence.priceDivergence.toFixed(2)}%) while RSI made lower high (${divergence.rsiDivergence.toFixed(2)} points)`,
        metadata: {
          symbol: coinSymbol,
          divergenceType: 'bearish',
          currentRSI,
          pivot1Index: divergence.pivot1.index,
          pivot1Price: divergence.pivot1.price,
          pivot1RSI: divergence.pivot1.rsi,
          pivot2Index: divergence.pivot2.index,
          pivot2Price: divergence.pivot2.price,
          pivot2RSI: divergence.pivot2.rsi,
          priceDivergence: divergence.priceDivergence,
          rsiDivergence: divergence.rsiDivergence
        }
      };
    }
  }

  /**
   * Calculate signal strength based on divergence magnitude
   */
  private calculateSignalStrength(divergence: DivergenceResult, config: RSIDivergenceConfig): number {
    // Strength based on how significant the divergence is
    const priceStrength = Math.abs(divergence.priceDivergence) / (config.minDivergencePercent * 3);
    const rsiStrength = Math.abs(divergence.rsiDivergence) / 20; // 20 RSI points = strong divergence

    // Combined strength
    return Math.min(1, Math.max(0.4, (priceStrength + rsiStrength) / 2));
  }

  /**
   * Calculate confidence based on divergence clarity and recency
   */
  private calculateConfidence(
    prices: PriceSummary[],
    rsi: number[],
    divergence: DivergenceResult,
    config: RSIDivergenceConfig
  ): number {
    const currentIndex = prices.length - 1;

    // Recency: More recent pivots = higher confidence
    const pivot2Age = currentIndex - divergence.pivot2.index;
    const recencyScore = 1 - Math.min(1, pivot2Age / config.lookbackPeriod);

    // Clarity: Larger divergence magnitude = higher confidence
    const clarityScore = Math.min(1, Math.abs(divergence.priceDivergence) / (config.minDivergencePercent * 2));

    // RSI position: For bullish divergence, RSI near oversold is better; for bearish, near overbought
    let rsiPositionScore = 0;
    const currentRSI = rsi[currentIndex];
    if (!isNaN(currentRSI)) {
      if (divergence.type === 'bullish' && currentRSI < 40) {
        rsiPositionScore = (40 - currentRSI) / 40;
      } else if (divergence.type === 'bearish' && currentRSI > 60) {
        rsiPositionScore = (currentRSI - 60) / 40;
      }
    }

    // Base confidence for divergence signals
    const baseConfidence = 0.5;

    return Math.min(1, baseConfidence + recencyScore * 0.2 + clarityScore * 0.15 + rsiPositionScore * 0.15);
  }

  /**
   * Prepare chart data with pivot points marked
   */
  private prepareChartData(prices: PriceSummary[], rsi: number[], config: RSIDivergenceConfig): ChartDataPoint[] {
    const currentIndex = prices.length - 1;
    const lookbackStart = Math.max(0, currentIndex - config.lookbackPeriod - config.pivotStrength);
    const lookbackEnd = currentIndex - config.pivotStrength;

    const pivotHighs = this.findPivotHighs(prices, rsi, config.pivotStrength, lookbackStart, lookbackEnd);
    const pivotLows = this.findPivotLows(prices, rsi, config.pivotStrength, lookbackStart, lookbackEnd);

    const pivotHighIndices = new Set(pivotHighs.map((p) => p.index));
    const pivotLowIndices = new Set(pivotLows.map((p) => p.index));

    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        rsi: rsi[index],
        isPivotHigh: pivotHighIndices.has(index),
        isPivotLow: pivotLowIndices.has(index),
        high: price.high,
        low: price.low
      }
    }));
  }

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      rsiPeriod: { type: 'number', default: 14, min: 5, max: 30, description: 'RSI calculation period' },
      lookbackPeriod: {
        type: 'number',
        default: 14,
        min: 5,
        max: 30,
        description: 'Lookback period for finding pivots'
      },
      pivotStrength: { type: 'number', default: 2, min: 1, max: 5, description: 'Bars on each side to confirm pivot' },
      minDivergencePercent: {
        type: 'number',
        default: 5,
        min: 1,
        max: 20,
        description: 'Minimum price divergence percentage'
      },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1, description: 'Minimum confidence required' }
    };
  }

  /**
   * Enhanced validation for RSI Divergence strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    for (const coin of context.coins) {
      if (!this.hasEnoughData(context.priceData[coin.id], config)) {
        return false;
      }
    }

    return true;
  }
}
