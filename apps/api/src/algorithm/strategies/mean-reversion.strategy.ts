import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../price/price.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

/**
 * Mean Reversion Algorithm Strategy
 * Generates trading signals based on price deviations from moving average
 * Assumes prices will revert to their mean over time
 */
@Injectable()
export class MeanReversionStrategy extends BaseAlgorithmStrategy {
  readonly id = 'mean-reversion-v2';
  readonly name = 'Mean Reversion';
  readonly version = '2.0.0';
  readonly description = 'Trading strategy that identifies overbought/oversold conditions using price deviation from moving average';

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
      const period = 20; // 20-day moving average
      const threshold = 2; // 2 standard deviations

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];
        
        if (!priceHistory || priceHistory.length < period + 1) {
          this.logger.warn(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate moving average and standard deviation
        const movingAverage = this.calculateMovingAverage(priceHistory, period);
        const standardDeviation = this.calculateStandardDeviation(priceHistory, movingAverage, period);

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

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, movingAverage, standardDeviation, threshold);
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
   * Calculate Simple Moving Average
   */
  private calculateMovingAverage(prices: PriceSummary[], period: number): number[] {
    const movingAverages: number[] = [];
    
    for (let i = 0; i < prices.length; i++) {
      if (i < period - 1) {
        movingAverages.push(NaN);
      } else {
        const sum = prices.slice(i - period + 1, i + 1).reduce((acc, price) => acc + price.avg, 0);
        movingAverages.push(sum / period);
      }
    }
    
    return movingAverages;
  }

  /**
   * Calculate Standard Deviation
   */
  private calculateStandardDeviation(prices: PriceSummary[], movingAverage: number[], period: number): number[] {
    const standardDeviations: number[] = [];
    
    for (let i = 0; i < prices.length; i++) {
      if (i < period - 1 || isNaN(movingAverage[i])) {
        standardDeviations.push(NaN);
      } else {
        const priceSlice = prices.slice(i - period + 1, i + 1);
        const mean = movingAverage[i];
        const variance = priceSlice.reduce((acc, price) => acc + Math.pow(price.avg - mean, 2), 0) / period;
        standardDeviations.push(Math.sqrt(variance));
      }
    }
    
    return standardDeviations;
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
        confidence: Math.min(0.9, absZScore / threshold * 0.3),
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
        confidence: Math.min(0.9, absZScore / threshold * 0.3),
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
   */
  private prepareChartData(
    prices: PriceSummary[],
    movingAverage: number[],
    standardDeviation: number[],
    threshold: number
  ): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        movingAverage: movingAverage[index],
        standardDeviation: standardDeviation[index],
        upperBand: movingAverage[index] + (standardDeviation[index] * threshold),
        lowerBand: movingAverage[index] - (standardDeviation[index] * threshold),
        zScore: isNaN(movingAverage[index]) || isNaN(standardDeviation[index]) 
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
      if (!priceHistory || priceHistory.length < 21) { // Need at least 21 data points for 20-period calculation
        return false;
      }
    }

    return true;
  }
}
