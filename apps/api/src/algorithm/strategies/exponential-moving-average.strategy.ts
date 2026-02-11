import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

/**
 * Exponential Moving Average (EMA) Algorithm Strategy
 *
 * Uses centralized IndicatorService for EMA calculations with caching.
 * Generates trading signals based on EMA crossovers and price momentum.
 *
 * Implements IIndicatorProvider for potential custom calculator overrides.
 */
@Injectable()
export class ExponentialMovingAverageStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'ema-crossover-001';

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
   * Execute the EMA algorithm
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      // Get configuration with defaults
      const fastPeriod = (context.config.fastPeriod as number) || 12;
      const slowPeriod = (context.config.slowPeriod as number) || 26;

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, slowPeriod)) {
          this.logger.warn(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate EMAs using IndicatorService (with caching)
        const ema12Result = await this.indicatorService.calculateEMA(
          { coinId: coin.id, prices: priceHistory, period: fastPeriod },
          this // Pass this strategy as IIndicatorProvider for custom override support
        );
        const ema26Result = await this.indicatorService.calculateEMA(
          { coinId: coin.id, prices: priceHistory, period: slowPeriod },
          this
        );

        const ema12 = ema12Result.values;
        const ema26 = ema26Result.values;

        // Generate signals based on EMA crossover
        const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, ema12, ema26);

        if (signal) {
          signals.push(signal);
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, ema12, ema26);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`EMA algorithm execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Generate trading signal based on EMA crossover
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    ema12: number[],
    ema26: number[]
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (previousIndex < 0 || isNaN(ema12[currentIndex]) || isNaN(ema26[currentIndex])) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const currentEma12 = ema12[currentIndex];
    const currentEma26 = ema26[currentIndex];
    const previousEma12 = ema12[previousIndex];
    const previousEma26 = ema26[previousIndex];

    // Check for crossover signals
    const isBullishCrossover = previousEma12 <= previousEma26 && currentEma12 > currentEma26;
    const isBearishCrossover = previousEma12 >= previousEma26 && currentEma12 < currentEma26;

    if (isBullishCrossover) {
      // Golden cross - buy signal
      return {
        type: SignalType.BUY,
        coinId,
        strength: this.calculateSignalStrength(currentPrice, currentEma12, currentEma26),
        price: currentPrice,
        confidence: this.calculateConfidence(prices, ema12, ema26, 'bullish'),
        reason: `Bullish EMA crossover: EMA12 (${currentEma12.toFixed(4)}) crossed above EMA26 (${currentEma26.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          ema12: currentEma12,
          ema26: currentEma26,
          crossoverType: 'golden'
        }
      };
    }

    if (isBearishCrossover) {
      // Death cross - sell signal
      return {
        type: SignalType.SELL,
        coinId,
        strength: this.calculateSignalStrength(currentPrice, currentEma12, currentEma26),
        price: currentPrice,
        confidence: this.calculateConfidence(prices, ema12, ema26, 'bearish'),
        reason: `Bearish EMA crossover: EMA12 (${currentEma12.toFixed(4)}) crossed below EMA26 (${currentEma26.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          ema12: currentEma12,
          ema26: currentEma26,
          crossoverType: 'death'
        }
      };
    }

    // No clear signal
    return null;
  }

  /**
   * Calculate signal strength based on price position relative to EMAs
   */
  private calculateSignalStrength(price: number, ema12: number, ema26: number): number {
    const spread = Math.abs(ema12 - ema26);
    const maxEma = Math.max(ema12, ema26);
    const emaSpread = maxEma > 0 ? spread / maxEma : 0;
    const pricePosition = spread > 0 ? (price - Math.min(ema12, ema26)) / spread : 0.5;

    return Math.min(1, Math.max(0, emaSpread * 2 + pricePosition * 0.5));
  }

  /**
   * Calculate confidence level for the signal
   */
  private calculateConfidence(
    prices: PriceSummary[],
    ema12: number[],
    ema26: number[],
    direction: 'bullish' | 'bearish'
  ): number {
    const recentPeriod = 5;
    const startIndex = Math.max(1, prices.length - recentPeriod);

    let convergingBars = 0;
    for (let i = startIndex; i < prices.length - 1; i++) {
      const currentGap = ema12[i] - ema26[i];
      const previousGap = ema12[i - 1] - ema26[i - 1];

      // For bullish: gap should be increasing (becoming more positive / less negative)
      // For bearish: gap should be decreasing (becoming more negative / less positive)
      if (direction === 'bullish' && currentGap > previousGap) {
        convergingBars++;
      } else if (direction === 'bearish' && currentGap < previousGap) {
        convergingBars++;
      }
    }

    const barsChecked = prices.length - 1 - startIndex;
    return barsChecked > 0 ? convergingBars / barsChecked : 0;
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(prices: PriceSummary[], ema12: number[], ema26: number[]): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        ema12: ema12[index],
        ema26: ema26[index],
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
      fastPeriod: { type: 'number', default: 12, min: 5, max: 50 },
      slowPeriod: { type: 'number', default: 26, min: 10, max: 100 },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1 },
      enableStopLoss: { type: 'boolean', default: true },
      stopLossPercentage: { type: 'number', default: 0.05, min: 0.01, max: 0.2 }
    };
  }

  /**
   * Enhanced validation for EMA algorithm
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const slowPeriod = (context.config.slowPeriod as number) || 26;

    // At least one coin must have sufficient price data for EMA calculation
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], slowPeriod));
  }

  private hasEnoughData(priceHistory: PriceSummary[] | undefined, slowPeriod: number): boolean {
    return !!priceHistory && priceHistory.length >= slowPeriod;
  }

  /**
   * Scheduled execution with context building
   */
  protected async scheduledExecution(): Promise<void> {
    try {
      if (!this.algorithm) {
        this.logger.warn('Algorithm not initialized for scheduled execution');
        return;
      }

      // You would typically inject the context builder here
      // For now, this is a placeholder for the scheduled execution logic
      this.logger.log('EMA scheduled execution completed');
    } catch (error) {
      this.logger.error(`Scheduled execution failed: ${error.message}`, error.stack);
    }
  }
}
