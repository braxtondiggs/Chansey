import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { ExitConfig, StopLossType, TakeProfitType } from '../../order/interfaces/exit-config.interface';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import {
  BollingerBandsResult,
  IIndicatorProvider,
  IndicatorCalculatorMap,
  IndicatorRequirement,
  IndicatorService
} from '../indicators';
import {
  AlgorithmContext,
  AlgorithmResult,
  ChartDataPoint,
  SignalType,
  TradingSignal,
  TradingStyle
} from '../interfaces';

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
  readonly id = 'mean-reversion-001';
  readonly tradingStyle = TradingStyle.MEAN_REVERTING;

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
      const stopLossPercent = (context.config.stopLossPercent as number) ?? 3.5;
      const takeProfitPercent = (context.config.takeProfitPercent as number) ?? 6;
      const isBacktest = !!(
        context.metadata?.backtestId ||
        context.metadata?.isOptimization ||
        context.metadata?.isLiveReplay
      );
      const skipCache = this.shouldSkipIndicatorCache(context);

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, period)) {
          this.logger.debug(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Dual-path: try precomputed indicators first, fall back to IndicatorService
        const bbKey = `bb_${period}_${threshold}`;
        const preUpper = this.getPrecomputedSlice(context, coin.id, `${bbKey}_upper`, priceHistory.length);
        let bollingerBandsResult: BollingerBandsResult;

        const preMiddle = preUpper
          ? this.getPrecomputedSlice(context, coin.id, `${bbKey}_middle`, priceHistory.length)
          : null;
        const preLower = preUpper
          ? this.getPrecomputedSlice(context, coin.id, `${bbKey}_lower`, priceHistory.length)
          : null;
        const prePb = preUpper ? this.getPrecomputedSlice(context, coin.id, `${bbKey}_pb`, priceHistory.length) : null;
        const preBandwidth = preUpper
          ? this.getPrecomputedSlice(context, coin.id, `${bbKey}_bandwidth`, priceHistory.length)
          : null;

        if (preUpper && preMiddle && preLower && prePb && preBandwidth) {
          bollingerBandsResult = {
            upper: preUpper,
            middle: preMiddle,
            lower: preLower,
            pb: prePb,
            bandwidth: preBandwidth,
            validCount: preUpper.filter((v) => Number.isFinite(v)).length,
            period,
            stdDev: threshold,
            fromCache: false
          };
        } else {
          if (preUpper) {
            this.logger.warn(`Partial BB cache for ${coin.symbol} (${bbKey}), recalculating`);
          }
          bollingerBandsResult = await this.indicatorService.calculateBollingerBands(
            { coinId: coin.id, prices: priceHistory, period, stdDev: threshold, skipCache },
            this // Pass this strategy as IIndicatorProvider for custom override support
          );
        }

        // Extract SMA from middle band; derive SD from upper band distance
        const movingAverage = bollingerBandsResult.middle;
        const standardDeviation = bollingerBandsResult.upper.map((u, i) =>
          !Number.isFinite(u) || !Number.isFinite(bollingerBandsResult.middle[i])
            ? NaN
            : (u - bollingerBandsResult.middle[i]) / threshold
        );

        // Generate signals based on mean reversion
        const signal = this.generateMeanReversionSignal(
          coin.id,
          coin.symbol,
          priceHistory,
          movingAverage,
          standardDeviation,
          threshold,
          stopLossPercent,
          takeProfitPercent
        );

        if (signal) {
          signals.push(signal);
        }

        if (!isBacktest) {
          chartData[coin.id] = this.prepareChartData(
            priceHistory,
            movingAverage,
            standardDeviation,
            threshold,
            bollingerBandsResult
          );
        }
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        period,
        threshold,
        signalsGenerated: signals.length
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Mean Reversion algorithm execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  /**
   * Generate mean reversion trading signal
   */
  private generateMeanReversionSignal(
    coinId: string,
    coinSymbol: string,
    prices: CandleData[],
    movingAverage: number[],
    standardDeviation: number[],
    threshold: number,
    stopLossPercent: number,
    takeProfitPercent: number
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const currentPrice = prices[currentIndex].avg;
    const currentMA = movingAverage[currentIndex];
    const currentStdDev = standardDeviation[currentIndex];

    if (!Number.isFinite(currentMA) || !Number.isFinite(currentStdDev) || currentStdDev === 0) {
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
        },
        exitConfig: this.buildExitConfig(absZScore, threshold, stopLossPercent, takeProfitPercent)
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
        },
        exitConfig: this.buildExitConfig(absZScore, threshold, stopLossPercent, takeProfitPercent)
      };
    }

    // No signal if within normal range
    return null;
  }

  /**
   * Build strategy-specific exit configuration for mean reversion.
   *
   * Stop-loss and take-profit base values come from the optimizer-tunable
   * schema params. Take-profit is scaled up by z-score distance from the mean
   * so stronger deviations aim for proportionally larger moves.
   */
  private buildExitConfig(
    absZScore: number,
    threshold: number,
    stopLossPercent: number,
    takeProfitPercent: number
  ): Partial<ExitConfig> {
    // Scale take-profit by z-score excess: at threshold σ use base, widen beyond
    const zScoreBoost = Math.max(0, (absZScore - threshold) / threshold);
    const takeProfitPct = Math.max(1, Math.min(40, takeProfitPercent * (1 + zScoreBoost * 0.5)));

    return {
      enableStopLoss: true,
      stopLossType: StopLossType.PERCENTAGE,
      stopLossValue: stopLossPercent,
      enableTakeProfit: true,
      takeProfitType: TakeProfitType.PERCENTAGE,
      takeProfitValue: takeProfitPct,
      enableTrailingStop: false,
      useOco: true
    };
  }

  /**
   * Prepare chart data for visualization
   * Includes Bollinger Bands for better visualization
   */
  private prepareChartData(
    prices: CandleData[],
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
          !Number.isFinite(movingAverage[index]) ||
          !Number.isFinite(standardDeviation[index]) ||
          standardDeviation[index] === 0
            ? NaN
            : (price.avg - movingAverage[index]) / standardDeviation[index]
      }
    }));
  }

  /**
   * Declare indicator requirements for precomputation during optimization.
   */
  getMinDataPoints(config: Record<string, unknown>): number {
    const period = (config.period as number) ?? 20;
    return period + 1;
  }

  getIndicatorRequirements(_config: Record<string, unknown>): IndicatorRequirement[] {
    return [
      { type: 'BOLLINGER_BANDS', paramKeys: ['period', 'threshold'], defaultParams: { period: 20, threshold: 2 } }
    ];
  }

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      period: { type: 'number', default: 20, min: 5, max: 100 },
      threshold: { type: 'number', default: 2, min: 1, max: 4 },
      minConfidence: { type: 'number', default: 0.4, min: 0, max: 1 },
      enableDynamicThreshold: { type: 'boolean', default: true },
      stopLossPercent: {
        type: 'number',
        default: 3.5,
        min: 1.5,
        max: 15,
        description: 'Stop-loss distance as percentage of entry price'
      },
      takeProfitPercent: {
        type: 'number',
        default: 6,
        min: 2,
        max: 20,
        description: 'Take-profit base distance as percentage of entry price (scaled by z-score)'
      }
    };
  }

  getParameterConstraints(): ParameterConstraint[] {
    return [
      {
        type: 'less_than',
        param1: 'stopLossPercent',
        param2: 'takeProfitPercent',
        message: 'stopLossPercent must be less than takeProfitPercent'
      }
    ];
  }

  /**
   * Enhanced validation for Mean Reversion algorithm
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const period = (context.config.period as number) || 20;

    // At least one coin must have sufficient price data for mean reversion calculation
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], period));
  }

  private hasEnoughData(priceHistory: CandleData[] | undefined, period: number): boolean {
    return !!priceHistory && priceHistory.length >= period + 1;
  }
}
