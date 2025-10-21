import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { SMA } from 'technicalindicators';

import { PriceSummary } from '../../price/price.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';
import { IndicatorDataTransformer } from '../utils/indicator-data-transformer';

/**
 * Simple Moving Average Crossover Strategy
 * Refactored to use technicalindicators library
 *
 * Uses battle-tested SMA implementation instead of custom calculations
 */
@Injectable()
export class SimpleMovingAverageCrossoverStrategy extends BaseAlgorithmStrategy {
  readonly id = 'sma-crossover-001';
  readonly name = 'Simple Moving Average Crossover';
  readonly version = '2.0.0';
  readonly description = 'Generates signals based on simple moving average crossovers between fast and slow periods';

  constructor(schedulerRegistry: SchedulerRegistry) {
    super(schedulerRegistry);
  }

  /**
   * Execute the SMA crossover algorithm
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      // Get configuration
      const fastPeriod = (context.config.fastPeriod as number) || 10;
      const slowPeriod = (context.config.slowPeriod as number) || 20;

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!priceHistory || priceHistory.length < slowPeriod) {
          this.logger.warn(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate SMAs using technicalindicators library
        const fastSMA = this.calculateSMA(priceHistory, fastPeriod);
        const slowSMA = this.calculateSMA(priceHistory, slowPeriod);

        // Generate signal
        const signal = this.generateCrossoverSignal(coin.id, coin.symbol, priceHistory, fastSMA, slowSMA);

        if (signal) {
          signals.push(signal);
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, fastSMA, slowSMA);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        fastPeriod,
        slowPeriod
      });
    } catch (error) {
      this.logger.error(`SMA Crossover algorithm execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Calculate Simple Moving Average using technicalindicators library
   *
   * @param prices - Array of PriceSummary objects
   * @param period - SMA period
   * @returns Array of SMA values (padded with NaN for alignment)
   */
  private calculateSMA(prices: PriceSummary[], period: number): number[] {
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
   * Generate crossover signal
   */
  private generateCrossoverSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    fastSMA: number[],
    slowSMA: number[]
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (previousIndex < 0 || isNaN(fastSMA[currentIndex]) || isNaN(slowSMA[currentIndex])) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const currentFast = fastSMA[currentIndex];
    const currentSlow = slowSMA[currentIndex];
    const previousFast = fastSMA[previousIndex];
    const previousSlow = slowSMA[previousIndex];

    // Golden Cross - Fast SMA crosses above Slow SMA
    if (previousFast <= previousSlow && currentFast > currentSlow) {
      return {
        type: SignalType.BUY,
        coinId,
        strength: 0.8,
        price: currentPrice,
        confidence: 0.75,
        reason: `Golden Cross: Fast SMA (${currentFast.toFixed(4)}) crossed above Slow SMA (${currentSlow.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          fastSMA: currentFast,
          slowSMA: currentSlow,
          crossoverType: 'golden'
        }
      };
    }

    // Death Cross - Fast SMA crosses below Slow SMA
    if (previousFast >= previousSlow && currentFast < currentSlow) {
      return {
        type: SignalType.SELL,
        coinId,
        strength: 0.8,
        price: currentPrice,
        confidence: 0.75,
        reason: `Death Cross: Fast SMA (${currentFast.toFixed(4)}) crossed below Slow SMA (${currentSlow.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          fastSMA: currentFast,
          slowSMA: currentSlow,
          crossoverType: 'death'
        }
      };
    }

    return null;
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(prices: PriceSummary[], fastSMA: number[], slowSMA: number[]): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        fastSMA: fastSMA[index],
        slowSMA: slowSMA[index],
        high: price.high,
        low: price.low
      }
    }));
  }

  /**
   * Get configuration schema for this algorithm
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      fastPeriod: {
        type: 'number',
        default: 10,
        min: 5,
        max: 50,
        description: 'Period for fast moving average'
      },
      slowPeriod: {
        type: 'number',
        default: 20,
        min: 10,
        max: 100,
        description: 'Period for slow moving average'
      },
      minConfidence: {
        type: 'number',
        default: 0.7,
        min: 0,
        max: 1,
        description: 'Minimum confidence level for signals'
      }
    };
  }

  /**
   * Validate that we have enough data for the algorithm
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const slowPeriod = (context.config.slowPeriod as number) || 20;

    // Check if we have sufficient price data
    for (const coin of context.coins) {
      const priceHistory = context.priceData[coin.id];
      if (!priceHistory || priceHistory.length < slowPeriod) {
        return false;
      }
    }

    return true;
  }
}
