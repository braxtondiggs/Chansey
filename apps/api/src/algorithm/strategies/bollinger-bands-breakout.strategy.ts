import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { ExitConfig, StopLossType, TakeProfitType } from '../../order/interfaces/exit-config.interface';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorRequirement, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface BollingerBreakoutConfig {
  period: number;
  stdDev: number;
  requireConfirmation: boolean;
  confirmationBars: number;
  minConfidence: number;
  squeezeFactor: number;
  stopLossPercent: number;
  takeProfitPercent: number;
}

/**
 * Bollinger Bands Breakout Strategy
 *
 * Trades breakouts when price closes outside Bollinger Bands.
 * Buy signal when price breaks above upper band (momentum breakout).
 * Sell signal when price breaks below lower band (breakdown).
 *
 * NOTE: This is OPPOSITE to mean reversion - we trade WITH the breakout.
 *
 * Uses centralized IndicatorService for Bollinger Bands calculations with caching.
 */
@Injectable()
export class BollingerBandsBreakoutStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'bb-breakout-001';

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
   * Execute the Bollinger Bands Breakout strategy
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      const config = this.getConfigWithDefaults(context.config);
      const isBacktest = !!(
        context.metadata?.backtestId ||
        context.metadata?.isOptimization ||
        context.metadata?.isLiveReplay
      );
      const skipCache = this.shouldSkipIndicatorCache(context);

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, config)) {
          this.logger.debug(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Dual-path: try precomputed indicators first, fall back to IndicatorService
        const bbKey = `bb_${config.period}_${config.stdDev}`;
        const preUpper = this.getPrecomputedSlice(context, coin.id, `${bbKey}_upper`, priceHistory.length);
        let upper: number[], middle: number[], lower: number[], pb: number[], bandwidth: number[];

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
          upper = preUpper;
          middle = preMiddle;
          lower = preLower;
          pb = prePb;
          bandwidth = preBandwidth;
        } else {
          if (preUpper) {
            this.logger.warn(`Partial BB cache for ${coin.symbol} (${bbKey}), recalculating`);
          }
          const bbResult = await this.indicatorService.calculateBollingerBands(
            {
              coinId: coin.id,
              prices: priceHistory,
              period: config.period,
              stdDev: config.stdDev,
              skipCache
            },
            this
          );
          ({ upper, middle, lower, pb, bandwidth } = bbResult);
        }

        // Generate signal based on breakouts
        const signal = this.generateSignal(
          coin.id,
          coin.symbol,
          priceHistory,
          upper,
          middle,
          lower,
          pb,
          bandwidth,
          config
        );

        if (signal && signal.confidence >= config.minConfidence) {
          signals.push(signal);
        }

        if (!isBacktest) {
          chartData[coin.id] = this.prepareChartData(priceHistory, upper, middle, lower, pb, bandwidth);
        }
      }

      return this.createSuccessResult(
        signals,
        chartData,
        {
          algorithm: this.name,
          version: this.version,
          signalsGenerated: signals.length
        },
        this.buildExitConfig(config)
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Bollinger Bands Breakout strategy execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): BollingerBreakoutConfig {
    return {
      period: (config.period as number) ?? 20,
      stdDev: (config.stdDev as number) ?? 2,
      requireConfirmation: (config.requireConfirmation as boolean) ?? true,
      confirmationBars: (config.confirmationBars as number) ?? 3,
      minConfidence: (config.minConfidence as number) ?? 0.5,
      squeezeFactor: (config.squeezeFactor as number) ?? 1.5,
      stopLossPercent: (config.stopLossPercent as number) ?? 3.5,
      takeProfitPercent: (config.takeProfitPercent as number) ?? 6
    };
  }

  private buildExitConfig(config: BollingerBreakoutConfig): Partial<ExitConfig> {
    return {
      enableStopLoss: true,
      stopLossType: StopLossType.PERCENTAGE,
      stopLossValue: config.stopLossPercent,
      enableTakeProfit: true,
      takeProfitType: TakeProfitType.PERCENTAGE,
      takeProfitValue: config.takeProfitPercent,
      enableTrailingStop: false,
      useOco: true
    };
  }

  /**
   * Check if we have enough data for Bollinger Bands calculation
   */
  private hasEnoughData(priceHistory: CandleData[] | undefined, config: BollingerBreakoutConfig): boolean {
    const minRequired = config.period + (config.requireConfirmation ? config.confirmationBars : 1);
    return !!priceHistory && priceHistory.length >= minRequired;
  }

  /**
   * Generate trading signal based on Bollinger Bands breakout
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: CandleData[],
    upper: number[],
    middle: number[],
    lower: number[],
    pb: number[],
    bandwidth: number[],
    config: BollingerBreakoutConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;

    if (
      !Number.isFinite(upper[currentIndex]) ||
      !Number.isFinite(lower[currentIndex]) ||
      !Number.isFinite(pb[currentIndex])
    ) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const currentUpper = upper[currentIndex];
    const currentMiddle = middle[currentIndex];
    const currentLower = lower[currentIndex];
    const currentPB = pb[currentIndex]; // %B: 0 = at lower, 1 = at upper, >1 = above upper, <0 = below lower
    const currentBandwidth = bandwidth[currentIndex];

    // Check for confirmation if required
    if (config.requireConfirmation) {
      const confirmed = this.checkConfirmation(prices, upper, lower, config, currentIndex);
      if (!confirmed.isConfirmed) {
        return null;
      }
      // Only generate signal in the confirmed direction
      if (confirmed.direction === 'bullish' && !(currentPB > 1)) return null;
      if (confirmed.direction === 'bearish' && !(currentPB < 0)) return null;
    }

    // Squeeze filter: reject signals when bandwidth is too wide (not a squeeze breakout)
    const bwLookback = 20;
    const bwStart = Math.max(0, currentIndex - bwLookback);
    let bwSum = 0;
    let bwCount = 0;
    for (let i = bwStart; i < currentIndex; i++) {
      if (Number.isFinite(bandwidth[i])) {
        bwSum += bandwidth[i];
        bwCount++;
      }
    }
    const avgBandwidth = bwCount > 0 ? bwSum / bwCount : currentBandwidth;
    if (currentBandwidth > avgBandwidth * config.squeezeFactor) return null;

    if (config.requireConfirmation) {
      // Confirmation already validated sustained breakout — just check direction
      if (currentPB > 1) {
        const strength = this.calculateSignalStrength(currentPB, 'bullish');
        const confidence = this.calculateConfidence(prices, pb, bandwidth, 'bullish', currentIndex);

        return {
          type: SignalType.BUY,
          coinId,
          strength,
          price: currentPrice,
          confidence,
          reason: `Bullish breakout: Price (${currentPrice.toFixed(2)}) broke above upper band (${currentUpper.toFixed(2)}), %B: ${currentPB.toFixed(2)}`,
          metadata: {
            symbol: coinSymbol,
            upperBand: currentUpper,
            middleBand: currentMiddle,
            lowerBand: currentLower,
            percentB: currentPB,
            bandwidth: currentBandwidth,
            breakoutType: 'bullish'
          }
        };
      }

      if (currentPB < 0) {
        const strength = this.calculateSignalStrength(currentPB, 'bearish');
        const confidence = this.calculateConfidence(prices, pb, bandwidth, 'bearish', currentIndex);

        return {
          type: SignalType.SELL,
          coinId,
          strength,
          price: currentPrice,
          confidence,
          reason: `Bearish breakout: Price (${currentPrice.toFixed(2)}) broke below lower band (${currentLower.toFixed(2)}), %B: ${currentPB.toFixed(2)}`,
          metadata: {
            symbol: coinSymbol,
            upperBand: currentUpper,
            middleBand: currentMiddle,
            lowerBand: currentLower,
            percentB: currentPB,
            bandwidth: currentBandwidth,
            breakoutType: 'bearish'
          }
        };
      }
    } else {
      // No confirmation — require fresh transition from inside bands
      const prevPB = currentIndex > 0 && Number.isFinite(pb[currentIndex - 1]) ? pb[currentIndex - 1] : undefined;

      // Bullish breakout: Price TRANSITIONS from inside to above upper band
      if (currentPB > 1 && prevPB !== undefined && prevPB <= 1) {
        const strength = this.calculateSignalStrength(currentPB, 'bullish');
        const confidence = this.calculateConfidence(prices, pb, bandwidth, 'bullish', currentIndex);

        return {
          type: SignalType.BUY,
          coinId,
          strength,
          price: currentPrice,
          confidence,
          reason: `Bullish breakout: Price (${currentPrice.toFixed(2)}) broke above upper band (${currentUpper.toFixed(2)}), %B: ${currentPB.toFixed(2)}`,
          metadata: {
            symbol: coinSymbol,
            upperBand: currentUpper,
            middleBand: currentMiddle,
            lowerBand: currentLower,
            percentB: currentPB,
            bandwidth: currentBandwidth,
            breakoutType: 'bullish'
          }
        };
      }

      // Bearish breakout: Price TRANSITIONS from inside to below lower band
      if (currentPB < 0 && prevPB !== undefined && prevPB >= 0) {
        const strength = this.calculateSignalStrength(currentPB, 'bearish');
        const confidence = this.calculateConfidence(prices, pb, bandwidth, 'bearish', currentIndex);

        return {
          type: SignalType.SELL,
          coinId,
          strength,
          price: currentPrice,
          confidence,
          reason: `Bearish breakout: Price (${currentPrice.toFixed(2)}) broke below lower band (${currentLower.toFixed(2)}), %B: ${currentPB.toFixed(2)}`,
          metadata: {
            symbol: coinSymbol,
            upperBand: currentUpper,
            middleBand: currentMiddle,
            lowerBand: currentLower,
            percentB: currentPB,
            bandwidth: currentBandwidth,
            breakoutType: 'bearish'
          }
        };
      }
    }

    return null;
  }

  /**
   * Check if breakout is confirmed over multiple bars
   */
  private checkConfirmation(
    prices: CandleData[],
    upper: number[],
    lower: number[],
    config: BollingerBreakoutConfig,
    currentIndex: number
  ): { isConfirmed: boolean; direction: 'bullish' | 'bearish' | null } {
    let bullishCount = 0;
    let bearishCount = 0;

    for (let i = currentIndex - config.confirmationBars + 1; i <= currentIndex; i++) {
      if (i < 0 || !Number.isFinite(upper[i]) || !Number.isFinite(lower[i])) continue;

      const price = prices[i].avg;
      if (price > upper[i]) bullishCount++;
      if (price < lower[i]) bearishCount++;
    }

    if (bullishCount >= config.confirmationBars) {
      return { isConfirmed: true, direction: 'bullish' };
    }
    if (bearishCount >= config.confirmationBars) {
      return { isConfirmed: true, direction: 'bearish' };
    }

    return { isConfirmed: false, direction: null };
  }

  /**
   * Calculate signal strength based on %B distance from bands
   */
  private calculateSignalStrength(percentB: number, direction: 'bullish' | 'bearish'): number {
    if (direction === 'bullish') {
      // %B > 1 means above upper band; higher %B = stronger breakout
      const excess = percentB - 1;
      return Math.min(1, Math.max(0.3, excess * 2));
    } else {
      // %B < 0 means below lower band; more negative = stronger breakdown
      const excess = Math.abs(percentB);
      return Math.min(1, Math.max(0.3, excess * 2));
    }
  }

  /**
   * Calculate confidence based on bandwidth expansion and momentum
   */
  private calculateConfidence(
    _prices: CandleData[],
    pb: number[],
    bandwidth: number[],
    direction: 'bullish' | 'bearish',
    currentIndex: number
  ): number {
    const lookback = 5;
    const startIndex = Math.max(0, currentIndex - lookback);

    // Check if bandwidth is expanding (volatility increasing)
    let bandwidthExpanding = 0;
    for (let i = startIndex + 1; i <= currentIndex; i++) {
      if (Number.isFinite(bandwidth[i]) && Number.isFinite(bandwidth[i - 1]) && bandwidth[i] > bandwidth[i - 1]) {
        bandwidthExpanding++;
      }
    }

    // Check momentum consistency
    let momentumConsistent = 0;
    for (let i = startIndex + 1; i <= currentIndex; i++) {
      if (Number.isFinite(pb[i]) && Number.isFinite(pb[i - 1])) {
        if (direction === 'bullish' && pb[i] > pb[i - 1]) momentumConsistent++;
        if (direction === 'bearish' && pb[i] < pb[i - 1]) momentumConsistent++;
      }
    }

    const bandwidthScore = bandwidthExpanding / lookback;
    const momentumScore = momentumConsistent / lookback;

    return Math.min(1, (bandwidthScore + momentumScore) / 2 + 0.3);
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(
    prices: CandleData[],
    upper: number[],
    middle: number[],
    lower: number[],
    pb: number[],
    bandwidth: number[]
  ): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        upperBand: upper[index],
        middleBand: middle[index],
        lowerBand: lower[index],
        percentB: pb[index],
        bandwidth: bandwidth[index],
        high: price.high,
        low: price.low
      }
    }));
  }

  /**
   * Declare indicator requirements for precomputation during optimization.
   */
  getMinDataPoints(config: Record<string, unknown>): number {
    const period = (config.period as number) ?? 20;
    const requireConfirmation = (config.requireConfirmation as boolean) ?? true;
    const confirmationBars = (config.confirmationBars as number) ?? 3;
    return period + (requireConfirmation ? confirmationBars : 1);
  }

  getIndicatorRequirements(_config: Record<string, unknown>): IndicatorRequirement[] {
    return [{ type: 'BOLLINGER_BANDS', paramKeys: ['period', 'stdDev'], defaultParams: { period: 20, stdDev: 2 } }];
  }

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      period: { type: 'number', default: 20, min: 15, max: 50, description: 'Bollinger Bands period' },
      stdDev: { type: 'number', default: 2, min: 1.5, max: 3, description: 'Standard deviation multiplier' },
      requireConfirmation: { type: 'boolean', default: true, description: 'Require multiple bars confirmation' },
      confirmationBars: { type: 'number', default: 3, min: 1, max: 5, description: 'Number of bars for confirmation' },
      minConfidence: { type: 'number', default: 0.5, min: 0, max: 1, description: 'Minimum confidence required' },
      squeezeFactor: {
        type: 'number',
        default: 1.5,
        min: 1.0,
        max: 3.0,
        description: 'Max bandwidth/avg to allow signals (lower = stricter squeeze)'
      },
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
        description: 'Take-profit distance as percentage of entry price'
      }
    };
  }

  /**
   * Enhanced validation for Bollinger Bands Breakout strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
