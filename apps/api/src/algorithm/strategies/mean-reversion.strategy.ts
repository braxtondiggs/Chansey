import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../price/price.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { BollingerBandsResult, IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

/**
 * Mean Reversion Algorithm Strategy
 *
 * Uses centralized IndicatorService for SMA, SD, and Bollinger Bands calculations with caching.
 * Generates trading signals based on price deviations from moving average.
 * Assumes prices will revert to their mean over time.
 *
 * Implements IIndicatorProvider for potential custom calculator overrides.
 */
@Injectable()
export class MeanReversionStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'f206b716-6be3-499f-8186-2581e9755a98';

  constructor(
    schedulerRegistry: SchedulerRegistry,
    private readonly indicatorService: IndicatorService
  ) {
    super(schedulerRegistry);
  }

  /**
   * Optional: Provide custom calculator override for specific indicators
   * Return undefined to use default library implementation
   */
  getCustomCalculator<T extends keyof IndicatorCalculatorMap>(
    _indicatorType: T
  ): IndicatorCalculatorMap[T] | undefined {
    // Use default calculators - override here if needed
    return undefined;
  }

  /**
   * Execute the Mean Reversion algorithm
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      // Get configuration with defaults
      const period = (context.config.period as number) || 20;
      const threshold = (context.config.threshold as number) || 2; // Standard deviations

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!priceHistory || priceHistory.length < period + 1) {
          this.logger.warn(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate Bollinger Bands (includes SMA + SD automatically) using IndicatorService
        const bollingerBandsResult = await this.indicatorService.calculateBollingerBands(
          { coinId: coin.id, prices: priceHistory, period, stdDev: threshold },
          this // Pass this strategy as IIndicatorProvider for custom override support
        );

        // Alternative: Calculate SMA and SD separately for more control
        const movingAverageResult = await this.indicatorService.calculateSMA(
          { coinId: coin.id, prices: priceHistory, period },
          this
        );
        const standardDeviationResult = await this.indicatorService.calculateSD(
          { coinId: coin.id, prices: priceHistory, period },
          this
        );

        const movingAverage = movingAverageResult.values;
        const standardDeviation = standardDeviationResult.values;

        // Generate signals based on mean reversion
        const signal = this.generateMeanReversionSignal(
          coin.id,
          coin.symbol,
          priceHistory,
          movingAverage,
          standardDeviation,
          threshold
        );

        if (signal) {
          signals.push(signal);
        }

        // Prepare chart data with Bollinger Bands
        chartData[coin.id] = this.prepareChartData(
          priceHistory,
          movingAverage,
          standardDeviation,
          threshold,
          bollingerBandsResult
        );
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        period,
        threshold,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`Mean Reversion algorithm execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Generate mean reversion trading signal
   */
  private generateMeanReversionSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    movingAverage: number[],
    standardDeviation: number[],
    threshold: number
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const currentPrice = prices[currentIndex].avg;
    const currentMA = movingAverage[currentIndex];
    const currentStdDev = standardDeviation[currentIndex];

    if (isNaN(currentMA) || isNaN(currentStdDev)) {
      return null;
    }

    // Calculate z-score (how many standard deviations from mean)
    const zScore = (currentPrice - currentMA) / currentStdDev;
    const absZScore = Math.abs(zScore);

    // Generate signals based on z-score thresholds
    if (zScore < -threshold) {
      // Price is oversold - potential buy signal
      return {
        type: SignalType.BUY,
        coinId,
        strength: Math.min(1, absZScore / threshold - 1),
        price: currentPrice,
        confidence: Math.min(0.9, (absZScore / threshold) * 0.3),
        reason: `Mean reversion buy signal: Price is ${absZScore.toFixed(2)} standard deviations below moving average`,
        metadata: {
          symbol: coinSymbol,
          zScore,
          movingAverage: currentMA,
          standardDeviation: currentStdDev,
          signalType: 'oversold'
        }
      };
    }

    if (zScore > threshold) {
      // Price is overbought - potential sell signal
      return {
        type: SignalType.SELL,
        coinId,
        strength: Math.min(1, absZScore / threshold - 1),
        price: currentPrice,
        confidence: Math.min(0.9, (absZScore / threshold) * 0.3),
        reason: `Mean reversion sell signal: Price is ${absZScore.toFixed(2)} standard deviations above moving average`,
        metadata: {
          symbol: coinSymbol,
          zScore,
          movingAverage: currentMA,
          standardDeviation: currentStdDev,
          signalType: 'overbought'
        }
      };
    }

    // No signal if within normal range
    return null;
  }

  /**
   * Prepare chart data for visualization
   * Includes Bollinger Bands for better visualization
   */
  private prepareChartData(
    prices: PriceSummary[],
    movingAverage: number[],
    standardDeviation: number[],
    threshold: number,
    bollingerBands: BollingerBandsResult
  ): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        movingAverage: movingAverage[index],
        standardDeviation: standardDeviation[index],
        upperBand: bollingerBands.upper[index] ?? movingAverage[index] + standardDeviation[index] * threshold,
        lowerBand: bollingerBands.lower[index] ?? movingAverage[index] - standardDeviation[index] * threshold,
        middleBand: bollingerBands.middle[index] ?? movingAverage[index],
        zScore:
          isNaN(movingAverage[index]) || isNaN(standardDeviation[index])
            ? NaN
            : (price.avg - movingAverage[index]) / standardDeviation[index]
      }
    }));
  }

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      period: { type: 'number', default: 20, min: 5, max: 100 },
      threshold: { type: 'number', default: 2, min: 1, max: 4 },
      minConfidence: { type: 'number', default: 0.5, min: 0, max: 1 },
      enableDynamicThreshold: { type: 'boolean', default: false }
    };
  }

  /**
   * Enhanced validation for Mean Reversion algorithm
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    // Check if we have sufficient price data for mean reversion calculation
    for (const coin of context.coins) {
      const priceHistory = context.priceData[coin.id];
      if (!priceHistory || priceHistory.length < 21) {
        // Need at least 21 data points for 20-period calculation
        return false;
      }
    }

    return true;
  }
}
