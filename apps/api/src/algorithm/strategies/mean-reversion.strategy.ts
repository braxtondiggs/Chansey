import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { BollingerBands, SD, SMA } from 'technicalindicators';

import { PriceSummary } from '../../price/price.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';
import { IndicatorDataTransformer } from '../utils/indicator-data-transformer';

/**
 * Mean Reversion Algorithm Strategy
 * Refactored to use technicalindicators library
 *
 * Uses battle-tested SMA and StandardDeviation implementations
 * Generates trading signals based on price deviations from moving average
 * Assumes prices will revert to their mean over time
 */
@Injectable()
export class MeanReversionStrategy extends BaseAlgorithmStrategy {
  readonly id = 'mean-reversion-v2';
  readonly name = 'Mean Reversion';
  readonly version = '3.0.0';
  readonly description =
    'Trading strategy that identifies overbought/oversold conditions using price deviation from moving average';

  constructor(schedulerRegistry: SchedulerRegistry) {
    super(schedulerRegistry);
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

        // Calculate Bollinger Bands (includes SMA + SD automatically)
        const bollingerBands = this.calculateBollingerBands(priceHistory, period, threshold);

        // Alternative: Calculate SMA and SD separately for more control
        const movingAverage = this.calculateMovingAverage(priceHistory, period);
        const standardDeviation = this.calculateStandardDeviation(priceHistory, period);

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
          bollingerBands
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
   * Calculate Bollinger Bands using technicalindicators library
   * Returns upper, middle, and lower bands
   *
   * @param prices - Array of PriceSummary objects
   * @param period - Period for the moving average
   * @param stdDev - Number of standard deviations for bands
   * @returns Array of Bollinger Bands values
   */
  private calculateBollingerBands(
    prices: PriceSummary[],
    period: number,
    stdDev: number
  ): Array<{ upper: number; middle: number; lower: number; pb?: number; bandwidth?: number }> {
    // Extract average prices
    const values = IndicatorDataTransformer.extractAveragePrices(prices);

    // Calculate Bollinger Bands using technicalindicators library
    const bbResults = BollingerBands.calculate({
      period,
      stdDev,
      values
    });

    // Pad results to match original length
    const paddingLength = prices.length - bbResults.length;
    const padding = new Array(paddingLength).fill({
      upper: NaN,
      middle: NaN,
      lower: NaN
    });

    return [...padding, ...bbResults];
  }

  /**
   * Calculate Simple Moving Average using technicalindicators library
   *
   * @param prices - Array of PriceSummary objects
   * @param period - SMA period
   * @returns Array of SMA values (padded with NaN for alignment)
   */
  private calculateMovingAverage(prices: PriceSummary[], period: number): number[] {
    // Extract average prices
    const values = IndicatorDataTransformer.extractAveragePrices(prices);

    // Calculate SMA using technicalindicators library
    const smaResults = SMA.calculate({
      period,
      values
    });

    // Pad results to match original length
    return IndicatorDataTransformer.padResults(smaResults, prices.length);
  }

  /**
   * Calculate Standard Deviation using technicalindicators library
   *
   * @param prices - Array of PriceSummary objects
   * @param period - Period for standard deviation calculation
   * @returns Array of standard deviation values (padded with NaN for alignment)
   */
  private calculateStandardDeviation(prices: PriceSummary[], period: number): number[] {
    // Extract average prices
    const values = IndicatorDataTransformer.extractAveragePrices(prices);

    // Calculate Standard Deviation using technicalindicators library
    const sdResults = SD.calculate({
      period,
      values
    });

    // Pad results to match original length
    return IndicatorDataTransformer.padResults(sdResults, prices.length);
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
    bollingerBands: Array<{ upper: number; middle: number; lower: number }>
  ): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        movingAverage: movingAverage[index],
        standardDeviation: standardDeviation[index],
        upperBand: bollingerBands[index]?.upper ?? movingAverage[index] + standardDeviation[index] * threshold,
        lowerBand: bollingerBands[index]?.lower ?? movingAverage[index] - standardDeviation[index] * threshold,
        middleBand: bollingerBands[index]?.middle ?? movingAverage[index],
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
