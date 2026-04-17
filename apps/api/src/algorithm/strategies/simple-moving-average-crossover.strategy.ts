import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorRequirement, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

/**
 * Simple Moving Average Crossover Strategy
 *
 * Uses centralized IndicatorService for SMA calculations with caching.
 * Generates signals based on simple moving average crossovers between fast and slow periods.
 *
 * Implements IIndicatorProvider for potential custom calculator overrides.
 */
@Injectable()
export class SimpleMovingAverageCrossoverStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'sma-crossover-001';

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
   * Execute the SMA crossover algorithm
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      // Get configuration
      const fastPeriod = (context.config.fastPeriod as number) ?? 20;
      const slowPeriod = (context.config.slowPeriod as number) ?? 50;
      const minConfidence = (context.config.minConfidence as number) ?? 0.4;
      const minSeparation = (context.config.minSeparation as number) ?? 0.005;
      const isBacktest = !!(
        context.metadata?.backtestId ||
        context.metadata?.isOptimization ||
        context.metadata?.isLiveReplay
      );
      const skipCache = this.shouldSkipIndicatorCache(context);

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, slowPeriod)) {
          this.logger.debug(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate SMAs (precomputed fast path or IndicatorService fallback)
        const fastSMA =
          this.getPrecomputedSlice(context, coin.id, `sma_${fastPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateSMA(
              { coinId: coin.id, prices: priceHistory, period: fastPeriod, skipCache },
              this
            )
          ).values;
        const slowSMA =
          this.getPrecomputedSlice(context, coin.id, `sma_${slowPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateSMA(
              { coinId: coin.id, prices: priceHistory, period: slowPeriod, skipCache },
              this
            )
          ).values;

        // Generate signal
        const signal = this.generateCrossoverSignal(
          coin.id,
          coin.symbol,
          priceHistory,
          fastSMA,
          slowSMA,
          minSeparation
        );

        if (signal && signal.confidence >= minConfidence) {
          signals.push(signal);
        }

        if (!isBacktest) {
          chartData[coin.id] = this.prepareChartData(priceHistory, fastSMA, slowSMA);
        }
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        fastPeriod,
        slowPeriod
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`SMA Crossover algorithm execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  /**
   * Generate crossover signal
   */
  private generateCrossoverSignal(
    coinId: string,
    coinSymbol: string,
    prices: CandleData[],
    fastSMA: number[],
    slowSMA: number[],
    minSeparation: number
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (
      previousIndex < 0 ||
      !Number.isFinite(fastSMA[currentIndex]) ||
      !Number.isFinite(slowSMA[currentIndex]) ||
      !Number.isFinite(fastSMA[previousIndex]) ||
      !Number.isFinite(slowSMA[previousIndex])
    ) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const currentFast = fastSMA[currentIndex];
    const currentSlow = slowSMA[currentIndex];
    const previousFast = fastSMA[previousIndex];
    const previousSlow = slowSMA[previousIndex];

    // Minimum separation filter: reject noise crosses
    const separation = Math.abs(currentFast - currentSlow) / currentSlow;
    if (separation < minSeparation) return null;

    // Dynamic strength and confidence based on separation and slope
    const strength = Math.min(1, Math.max(0.4, separation * 20));

    // Golden Cross - Fast SMA crosses above Slow SMA
    if (previousFast <= previousSlow && currentFast > currentSlow) {
      const slopeBonus = currentFast > previousFast ? 0.1 : 0;
      const confidence = Math.min(1, Math.max(0.4, 0.4 + separation * 10 + slopeBonus));

      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Golden Cross: Fast SMA (${currentFast.toFixed(4)}) crossed above Slow SMA (${currentSlow.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          fastSMA: currentFast,
          slowSMA: currentSlow,
          crossoverType: 'golden',
          separation
        }
      };
    }

    // Death Cross - Fast SMA crosses below Slow SMA
    if (previousFast >= previousSlow && currentFast < currentSlow) {
      const slopeBonus = currentFast < previousFast ? 0.1 : 0;
      const confidence = Math.min(1, Math.max(0.4, 0.4 + separation * 10 + slopeBonus));

      return {
        type: SignalType.SELL,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Death Cross: Fast SMA (${currentFast.toFixed(4)}) crossed below Slow SMA (${currentSlow.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          fastSMA: currentFast,
          slowSMA: currentSlow,
          crossoverType: 'death',
          separation
        }
      };
    }

    return null;
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(prices: CandleData[], fastSMA: number[], slowSMA: number[]): ChartDataPoint[] {
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

  getMinDataPoints(config: Record<string, unknown>): number {
    const slowPeriod = (config.slowPeriod as number) ?? 50;
    return slowPeriod + 1;
  }

  getIndicatorRequirements(_config: Record<string, unknown>): IndicatorRequirement[] {
    return [
      { type: 'SMA', paramKeys: ['fastPeriod'], defaultParams: { fastPeriod: 20 } },
      { type: 'SMA', paramKeys: ['slowPeriod'], defaultParams: { slowPeriod: 50 } }
    ];
  }

  getParameterConstraints(): ParameterConstraint[] {
    return [
      {
        type: 'less_than',
        param1: 'fastPeriod',
        param2: 'slowPeriod',
        message: 'fastPeriod must be less than slowPeriod'
      }
    ];
  }

  /**
   * Get configuration schema for this algorithm
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      fastPeriod: {
        type: 'number',
        default: 20,
        min: 5,
        max: 50,
        description: 'Period for fast moving average'
      },
      slowPeriod: {
        type: 'number',
        default: 50,
        min: 10,
        max: 100,
        description: 'Period for slow moving average'
      },
      minConfidence: {
        type: 'number',
        default: 0.4,
        min: 0,
        max: 1,
        description: 'Minimum confidence level for signals'
      },
      minSeparation: {
        type: 'number',
        default: 0.005,
        min: 0,
        max: 0.05,
        description: 'Min |fast-slow|/slow to recognize a cross. Filters noise.'
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

    const slowPeriod = (context.config.slowPeriod as number) || 50;

    // At least one coin must have sufficient price data
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], slowPeriod));
  }

  private hasEnoughData(priceHistory: CandleData[] | undefined, slowPeriod: number): boolean {
    return !!priceHistory && priceHistory.length >= slowPeriod + 1;
  }
}
