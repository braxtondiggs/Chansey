import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface MACDConfig {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  useHistogramConfirmation: boolean;
  minHistogramStrength: number;
  minConfidence: number;
}

/**
 * MACD (Moving Average Convergence Divergence) Crossover Strategy
 *
 * Generates buy signals when MACD line crosses above signal line (bullish crossover)
 * and sell signals when MACD crosses below signal line (bearish crossover).
 *
 * Uses centralized IndicatorService for MACD calculations with caching.
 */
@Injectable()
export class MACDStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'macd-crossover-001';

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
   * Execute the MACD strategy
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

        // Calculate MACD using IndicatorService (with caching)
        const macdResult = await this.indicatorService.calculateMACD(
          {
            coinId: coin.id,
            prices: priceHistory,
            fastPeriod: config.fastPeriod,
            slowPeriod: config.slowPeriod,
            signalPeriod: config.signalPeriod
          },
          this
        );

        const { macd, signal, histogram } = macdResult;

        // Generate signal based on MACD crossover
        const tradingSignal = this.generateSignal(coin.id, coin.symbol, priceHistory, macd, signal, histogram, config);

        if (tradingSignal && tradingSignal.confidence >= config.minConfidence) {
          signals.push(tradingSignal);
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, macd, signal, histogram);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`MACD strategy execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): MACDConfig {
    return {
      fastPeriod: (config.fastPeriod as number) || 12,
      slowPeriod: (config.slowPeriod as number) || 26,
      signalPeriod: (config.signalPeriod as number) || 9,
      useHistogramConfirmation: (config.useHistogramConfirmation as boolean) ?? true,
      minHistogramStrength: (config.minHistogramStrength as number) || 0.0001,
      minConfidence: (config.minConfidence as number) || 0.6
    };
  }

  /**
   * Check if we have enough data for MACD calculation
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: MACDConfig): boolean {
    const minRequired = config.slowPeriod + config.signalPeriod;
    return !!priceHistory && priceHistory.length >= minRequired;
  }

  /**
   * Generate trading signal based on MACD crossover
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    macd: number[],
    signal: number[],
    histogram: number[],
    config: MACDConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (
      previousIndex < 0 ||
      isNaN(macd[currentIndex]) ||
      isNaN(signal[currentIndex]) ||
      isNaN(macd[previousIndex]) ||
      isNaN(signal[previousIndex])
    ) {
      return null;
    }

    const currentMACD = macd[currentIndex];
    const currentSignal = signal[currentIndex];
    const currentHistogram = histogram[currentIndex];
    const previousMACD = macd[previousIndex];
    const previousSignal = signal[previousIndex];
    const previousHistogram = histogram[previousIndex];
    const currentPrice = prices[currentIndex].avg;

    // Check for crossovers
    const isBullishCrossover = previousMACD <= previousSignal && currentMACD > currentSignal;
    const isBearishCrossover = previousMACD >= previousSignal && currentMACD < currentSignal;

    // Optional histogram confirmation
    const histogramConfirmed =
      !config.useHistogramConfirmation ||
      (isBullishCrossover && currentHistogram > config.minHistogramStrength) ||
      (isBearishCrossover && currentHistogram < -config.minHistogramStrength);

    if (isBullishCrossover && histogramConfirmed) {
      const strength = this.calculateSignalStrength(macd, signal, histogram, 'bullish');
      const confidence = this.calculateConfidence(macd, signal, histogram, 'bullish');

      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Bullish MACD crossover: MACD (${currentMACD.toFixed(6)}) crossed above Signal (${currentSignal.toFixed(6)})`,
        metadata: {
          symbol: coinSymbol,
          macd: currentMACD,
          signal: currentSignal,
          histogram: currentHistogram,
          previousMACD,
          previousSignal,
          previousHistogram,
          crossoverType: 'bullish'
        }
      };
    }

    if (isBearishCrossover && histogramConfirmed) {
      const strength = this.calculateSignalStrength(macd, signal, histogram, 'bearish');
      const confidence = this.calculateConfidence(macd, signal, histogram, 'bearish');

      return {
        type: SignalType.SELL,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Bearish MACD crossover: MACD (${currentMACD.toFixed(6)}) crossed below Signal (${currentSignal.toFixed(6)})`,
        metadata: {
          symbol: coinSymbol,
          macd: currentMACD,
          signal: currentSignal,
          histogram: currentHistogram,
          previousMACD,
          previousSignal,
          previousHistogram,
          crossoverType: 'bearish'
        }
      };
    }

    return null;
  }

  /**
   * Calculate signal strength based on histogram magnitude and crossover velocity
   */
  private calculateSignalStrength(
    macd: number[],
    signal: number[],
    histogram: number[],
    direction: 'bullish' | 'bearish'
  ): number {
    const currentIndex = macd.length - 1;

    // Calculate average histogram magnitude for normalization
    let sumMagnitude = 0;
    let count = 0;
    for (let i = Math.max(0, currentIndex - 20); i <= currentIndex; i++) {
      if (!isNaN(histogram[i])) {
        sumMagnitude += Math.abs(histogram[i]);
        count++;
      }
    }
    const avgMagnitude = count > 0 ? sumMagnitude / count : Math.abs(histogram[currentIndex]);

    // Strength based on current histogram relative to average
    const currentMagnitude = Math.abs(histogram[currentIndex]);
    const strength = Math.min(1, currentMagnitude / (avgMagnitude * 2));

    return Math.max(0.3, strength); // Minimum strength of 0.3 for valid crossover
  }

  /**
   * Calculate confidence based on MACD trend momentum
   */
  private calculateConfidence(
    macd: number[],
    signal: number[],
    histogram: number[],
    direction: 'bullish' | 'bearish'
  ): number {
    const recentPeriod = 5;
    const currentIndex = macd.length - 1;
    const startIndex = Math.max(0, currentIndex - recentPeriod);

    let trendingBars = 0;
    let histogramGrowing = 0;

    for (let i = startIndex + 1; i <= currentIndex; i++) {
      if (isNaN(histogram[i]) || isNaN(histogram[i - 1])) continue;

      if (direction === 'bullish') {
        // Check if histogram is growing (becoming more positive or less negative)
        if (histogram[i] > histogram[i - 1]) histogramGrowing++;
        // Check if MACD is above signal
        if (!isNaN(macd[i]) && !isNaN(signal[i]) && macd[i] > signal[i]) trendingBars++;
      } else {
        // Check if histogram is shrinking (becoming more negative or less positive)
        if (histogram[i] < histogram[i - 1]) histogramGrowing++;
        // Check if MACD is below signal
        if (!isNaN(macd[i]) && !isNaN(signal[i]) && macd[i] < signal[i]) trendingBars++;
      }
    }

    const histogramScore = histogramGrowing / recentPeriod;
    const trendScore = trendingBars / recentPeriod;

    return Math.min(1, (histogramScore + trendScore) / 2 + 0.3);
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(
    prices: PriceSummary[],
    macd: number[],
    signal: number[],
    histogram: number[]
  ): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        macd: macd[index],
        signal: signal[index],
        histogram: histogram[index],
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
      fastPeriod: { type: 'number', default: 12, min: 5, max: 20, description: 'Fast EMA period for MACD' },
      slowPeriod: { type: 'number', default: 26, min: 15, max: 50, description: 'Slow EMA period for MACD' },
      signalPeriod: { type: 'number', default: 9, min: 5, max: 15, description: 'Signal line period' },
      useHistogramConfirmation: { type: 'boolean', default: true, description: 'Require histogram confirmation' },
      minHistogramStrength: {
        type: 'number',
        default: 0.0001,
        min: 0,
        max: 0.01,
        description: 'Minimum histogram value'
      },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1, description: 'Minimum confidence required' }
    };
  }

  /**
   * Enhanced validation for MACD strategy
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
