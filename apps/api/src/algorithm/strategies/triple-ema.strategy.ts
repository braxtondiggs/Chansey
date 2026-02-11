import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface TripleEMAConfig {
  fastPeriod: number;
  mediumPeriod: number;
  slowPeriod: number;
  requireFullAlignment: boolean;
  signalOnPartialCross: boolean;
  minConfidence: number;
}

type EMAAlignment = 'bullish' | 'bearish' | 'neutral';

interface AlignmentState {
  current: EMAAlignment;
  previous: EMAAlignment;
  fastAboveMedium: boolean;
  mediumAboveSlow: boolean;
  fastAboveSlow: boolean;
  emaSpread: number;
}

/**
 * Triple EMA Strategy
 *
 * Uses three EMAs (fast, medium, slow) to identify strong trends.
 * Strong bullish signal: Fast > Medium > Slow (all aligned bullish)
 * Strong bearish signal: Fast < Medium < Slow (all aligned bearish)
 *
 * Generates signals when EMA alignment changes, indicating trend shifts.
 *
 * Uses centralized IndicatorService for EMA calculations with caching.
 */
@Injectable()
export class TripleEMAStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'triple-ema-001';

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
   * Execute the Triple EMA strategy
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

        // Calculate all three EMAs using IndicatorService (with caching)
        const [fastEMAResult, mediumEMAResult, slowEMAResult] = await Promise.all([
          this.indicatorService.calculateEMA(
            { coinId: coin.id, prices: priceHistory, period: config.fastPeriod },
            this
          ),
          this.indicatorService.calculateEMA(
            { coinId: coin.id, prices: priceHistory, period: config.mediumPeriod },
            this
          ),
          this.indicatorService.calculateEMA({ coinId: coin.id, prices: priceHistory, period: config.slowPeriod }, this)
        ]);

        const fastEMA = fastEMAResult.values;
        const mediumEMA = mediumEMAResult.values;
        const slowEMA = slowEMAResult.values;

        // Generate signal based on EMA alignment
        const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, fastEMA, mediumEMA, slowEMA, config);

        if (signal && signal.confidence >= config.minConfidence) {
          signals.push(signal);
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, fastEMA, mediumEMA, slowEMA);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`Triple EMA strategy execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): TripleEMAConfig {
    return {
      fastPeriod: (config.fastPeriod as number) ?? 8,
      mediumPeriod: (config.mediumPeriod as number) ?? 21,
      slowPeriod: (config.slowPeriod as number) ?? 55,
      requireFullAlignment: (config.requireFullAlignment as boolean) ?? true,
      signalOnPartialCross: (config.signalOnPartialCross as boolean) ?? false,
      minConfidence: (config.minConfidence as number) ?? 0.6
    };
  }

  /**
   * Check if we have enough data for all three EMAs
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: TripleEMAConfig): boolean {
    return !!priceHistory && priceHistory.length >= config.slowPeriod + 5;
  }

  /**
   * Determine EMA alignment at a specific index
   */
  private getAlignment(fastEMA: number, mediumEMA: number, slowEMA: number): EMAAlignment {
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
  private analyzeAlignmentState(
    fastEMA: number[],
    mediumEMA: number[],
    slowEMA: number[],
    currentIndex: number
  ): AlignmentState | null {
    const previousIndex = currentIndex - 1;

    if (
      previousIndex < 0 ||
      isNaN(fastEMA[currentIndex]) ||
      isNaN(mediumEMA[currentIndex]) ||
      isNaN(slowEMA[currentIndex]) ||
      isNaN(fastEMA[previousIndex]) ||
      isNaN(mediumEMA[previousIndex]) ||
      isNaN(slowEMA[previousIndex])
    ) {
      return null;
    }

    const currentFast = fastEMA[currentIndex];
    const currentMedium = mediumEMA[currentIndex];
    const currentSlow = slowEMA[currentIndex];
    const previousFast = fastEMA[previousIndex];
    const previousMedium = mediumEMA[previousIndex];
    const previousSlow = slowEMA[previousIndex];

    const currentAlignment = this.getAlignment(currentFast, currentMedium, currentSlow);
    const previousAlignment = this.getAlignment(previousFast, previousMedium, previousSlow);

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
   * Generate trading signal based on EMA alignment changes
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    fastEMA: number[],
    mediumEMA: number[],
    slowEMA: number[],
    config: TripleEMAConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const alignmentState = this.analyzeAlignmentState(fastEMA, mediumEMA, slowEMA, currentIndex);

    if (!alignmentState) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const currentFast = fastEMA[currentIndex];
    const currentMedium = mediumEMA[currentIndex];
    const currentSlow = slowEMA[currentIndex];

    // Check for full alignment change (strongest signal)
    if (alignmentState.current !== alignmentState.previous) {
      if (alignmentState.current === 'bullish') {
        // Transition to bullish alignment
        const strength = this.calculateSignalStrength(alignmentState);
        const confidence = this.calculateConfidence(fastEMA, mediumEMA, slowEMA, alignmentState, currentIndex, true);

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

      if (alignmentState.current === 'bearish') {
        // Transition to bearish alignment
        const strength = this.calculateSignalStrength(alignmentState);
        const confidence = this.calculateConfidence(fastEMA, mediumEMA, slowEMA, alignmentState, currentIndex, false);

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
    }

    // Optional: Signal on partial crossover (fast/medium cross while medium/slow aligned)
    if (config.signalOnPartialCross && !config.requireFullAlignment) {
      const prevFastAboveMedium = fastEMA[currentIndex - 1] > mediumEMA[currentIndex - 1];
      const fastMediumCrossover = alignmentState.fastAboveMedium !== prevFastAboveMedium;

      if (fastMediumCrossover && alignmentState.mediumAboveSlow && alignmentState.fastAboveMedium) {
        // Fast crossed above medium while medium > slow (bullish partial)
        const strength = this.calculateSignalStrength(alignmentState) * 0.7;
        const confidence =
          this.calculateConfidence(fastEMA, mediumEMA, slowEMA, alignmentState, currentIndex, true) * 0.8;

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
        const strength = this.calculateSignalStrength(alignmentState) * 0.7;
        const confidence =
          this.calculateConfidence(fastEMA, mediumEMA, slowEMA, alignmentState, currentIndex, false) * 0.8;

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
   * Calculate signal strength based on EMA spread
   */
  private calculateSignalStrength(alignmentState: AlignmentState): number {
    // Larger EMA spread indicates stronger trend
    const spreadStrength = Math.min(1, alignmentState.emaSpread * 10); // 10% spread = max strength

    // Full alignment gives higher base strength
    const alignmentStrength = alignmentState.current !== 'neutral' ? 0.5 : 0.3;

    return Math.min(1, Math.max(0.4, alignmentStrength + spreadStrength * 0.5));
  }

  /**
   * Calculate confidence based on trend consistency
   */
  private calculateConfidence(
    fastEMA: number[],
    mediumEMA: number[],
    slowEMA: number[],
    alignmentState: AlignmentState,
    currentIndex: number,
    isBullish: boolean
  ): number {
    const lookback = 5;
    const startIndex = Math.max(0, currentIndex - lookback);

    // Check how many recent bars had consistent alignment trend
    let consistentBars = 0;
    let validBars = 0;
    for (let i = startIndex; i < currentIndex; i++) {
      if (isNaN(fastEMA[i]) || isNaN(mediumEMA[i]) || isNaN(slowEMA[i])) continue;

      validBars++;
      const barAlignment = this.getAlignment(fastEMA[i], mediumEMA[i], slowEMA[i]);
      if (isBullish && (barAlignment === 'bullish' || barAlignment === 'neutral')) {
        consistentBars++;
      } else if (!isBullish && (barAlignment === 'bearish' || barAlignment === 'neutral')) {
        consistentBars++;
      }
    }

    const consistencyScore = validBars > 0 ? consistentBars / validBars : 0;

    // EMA spread contributes to confidence
    const spreadScore = Math.min(1, alignmentState.emaSpread * 8);

    // Base confidence for alignment signals
    const baseConfidence = 0.5;

    return Math.min(1, baseConfidence + consistencyScore * 0.25 + spreadScore * 0.25);
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(
    prices: PriceSummary[],
    fastEMA: number[],
    mediumEMA: number[],
    slowEMA: number[]
  ): ChartDataPoint[] {
    return prices.map((price, index) => {
      const alignment =
        !isNaN(fastEMA[index]) && !isNaN(mediumEMA[index]) && !isNaN(slowEMA[index])
          ? this.getAlignment(fastEMA[index], mediumEMA[index], slowEMA[index])
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

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      fastPeriod: { type: 'number', default: 8, min: 3, max: 15, description: 'Fast EMA period' },
      mediumPeriod: { type: 'number', default: 21, min: 10, max: 30, description: 'Medium EMA period' },
      slowPeriod: { type: 'number', default: 55, min: 30, max: 100, description: 'Slow EMA period' },
      requireFullAlignment: { type: 'boolean', default: true, description: 'Require all 3 EMAs aligned for signal' },
      signalOnPartialCross: { type: 'boolean', default: false, description: 'Signal on fast/medium crossover' },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1, description: 'Minimum confidence required' }
    };
  }

  /**
   * Enhanced validation for Triple EMA strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
