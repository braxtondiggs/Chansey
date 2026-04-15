import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorRequirement, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface BollingerSqueezeConfig {
  period: number;
  stdDev: number;
  squeezeThreshold: number;
  minSqueezeBars: number;
  breakoutConfirmation: boolean;
  minConfidence: number;
}

interface SqueezeState {
  isInSqueeze: boolean;
  squeezeBars: number;
  squeezeStartIndex: number;
  avgBandwidthDuringSqueeze: number;
}

interface BollingerBandsData {
  upper: number[];
  middle: number[];
  lower: number[];
  pb: number[];
  bandwidth: number[];
}

/**
 * Bollinger Band Squeeze Strategy
 *
 * Identifies low volatility squeeze conditions and trades the subsequent breakout.
 * Low bandwidth signals impending volatility expansion.
 *
 * A "squeeze" occurs when Bollinger Band bandwidth falls below a threshold.
 * When the squeeze ends, the direction of the breakout determines the signal.
 *
 * Uses centralized IndicatorService for Bollinger Bands calculations with caching.
 */
@Injectable()
export class BollingerBandSqueezeStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'bb-squeeze-001';

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

  /** Timeout for individual coin BB calculation (prevents indefinite hangs) */
  private static readonly COIN_CALCULATION_TIMEOUT_MS = 15_000;

  /**
   * Execute the Bollinger Band Squeeze strategy
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};
    const executeStart = Date.now();

    try {
      const config = this.getConfigWithDefaults(context.config);
      const isBacktest = !!(
        context.metadata?.backtestId ||
        context.metadata?.isOptimization ||
        context.metadata?.isLiveReplay
      );
      const eligibleCoins = context.coins.filter((coin) => this.hasEnoughData(context.priceData[coin.id], config));

      this.logger.debug(
        `BB Squeeze execute: ${eligibleCoins.length}/${context.coins.length} coins eligible, ` +
          `timestamp=${context.timestamp?.toISOString?.() ?? 'unknown'}`
      );

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, config)) {
          continue;
        }

        const coinStart = Date.now();

        const bands = await this.loadBollingerBands(coin, priceHistory, context, config);
        if (!bands) continue;

        const bbDuration = Date.now() - coinStart;

        const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, bands, config);
        if (signal && signal.confidence >= config.minConfidence) {
          signals.push(signal);
        }

        if (!isBacktest) {
          chartData[coin.id] = this.prepareChartData(priceHistory, bands, config);
        }

        const totalCoinDuration = Date.now() - coinStart;
        if (totalCoinDuration > 2000) {
          this.logger.warn(
            `BB Squeeze: slow coin processing for ${coin.symbol}: ${totalCoinDuration}ms total ` +
              `(bb=${bbDuration}ms, chart=${totalCoinDuration - bbDuration}ms, ${priceHistory.length} prices)`
          );
        }
      }

      const totalDuration = Date.now() - executeStart;
      if (totalDuration > 3000) {
        this.logger.warn(
          `BB Squeeze: slow execute total: ${totalDuration}ms ` +
            `(${eligibleCoins.length} coins, ${signals.length} signals)`
        );
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Bollinger Band Squeeze strategy execution failed after ${Date.now() - executeStart}ms: ${err.message}`,
        err.stack
      );
      return this.createErrorResult(err.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): BollingerSqueezeConfig {
    return {
      period: (config.period as number) ?? 20,
      stdDev: (config.stdDev as number) ?? 2,
      squeezeThreshold: (config.squeezeThreshold as number) ?? 0.05, // 5% bandwidth
      minSqueezeBars: (config.minSqueezeBars as number) ?? 4,
      breakoutConfirmation: (config.breakoutConfirmation as boolean) ?? true,
      minConfidence: (config.minConfidence as number) ?? 0.5
    };
  }

  /**
   * Check if we have enough data for squeeze detection
   */
  private hasEnoughData(priceHistory: CandleData[] | undefined, config: BollingerSqueezeConfig): boolean {
    const minRequired = config.period + config.minSqueezeBars + 5;
    return !!priceHistory && priceHistory.length >= minRequired;
  }

  /**
   * Analyze squeeze state over recent bars
   */
  private analyzeSqueezeState(bandwidth: number[], config: BollingerSqueezeConfig, currentIndex: number): SqueezeState {
    // Look back to find squeeze start
    let squeezeBars = 0;
    let squeezeStartIndex = -1;
    let totalBandwidth = 0;

    // Count consecutive bars in squeeze ending at previous bar (not current)
    for (let i = currentIndex - 1; i >= 0 && i >= currentIndex - config.minSqueezeBars * 2; i--) {
      if (!Number.isFinite(bandwidth[i])) break;

      if (bandwidth[i] < config.squeezeThreshold) {
        squeezeBars++;
        totalBandwidth += bandwidth[i];
        if (squeezeStartIndex === -1 || i < squeezeStartIndex) {
          squeezeStartIndex = i;
        }
      } else {
        // Squeeze ended
        break;
      }
    }

    const isInSqueeze = Number.isFinite(bandwidth[currentIndex]) && bandwidth[currentIndex] < config.squeezeThreshold;
    const avgBandwidthDuringSqueeze = squeezeBars > 0 ? totalBandwidth / squeezeBars : 0;

    return {
      isInSqueeze,
      squeezeBars,
      squeezeStartIndex,
      avgBandwidthDuringSqueeze
    };
  }

  /**
   * Load Bollinger Bands data from precomputed cache or calculate with timeout.
   */
  private async loadBollingerBands(
    coin: { id: string; symbol: string },
    priceHistory: CandleData[],
    context: AlgorithmContext,
    config: BollingerSqueezeConfig
  ): Promise<BollingerBandsData | null> {
    const bbKey = `bb_${config.period}_${config.stdDev}`;
    const preUpper = this.getPrecomputedSlice(context, coin.id, `${bbKey}_upper`, priceHistory.length);

    if (preUpper) {
      return {
        upper: preUpper,
        middle: this.getPrecomputedSlice(context, coin.id, `${bbKey}_middle`, priceHistory.length) as number[],
        lower: this.getPrecomputedSlice(context, coin.id, `${bbKey}_lower`, priceHistory.length) as number[],
        pb: this.getPrecomputedSlice(context, coin.id, `${bbKey}_pb`, priceHistory.length) as number[],
        bandwidth: this.getPrecomputedSlice(context, coin.id, `${bbKey}_bandwidth`, priceHistory.length) as number[]
      };
    }

    const coinStart = Date.now();
    let bbResult: Awaited<ReturnType<typeof this.indicatorService.calculateBollingerBands>>;
    try {
      const bbPromise = this.indicatorService.calculateBollingerBands(
        { coinId: coin.id, prices: priceHistory, period: config.period, stdDev: config.stdDev },
        this
      );

      let timerId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () =>
            reject(
              new Error(
                `BB calculation timed out for ${coin.symbol} after ${BollingerBandSqueezeStrategy.COIN_CALCULATION_TIMEOUT_MS}ms (${priceHistory.length} prices)`
              )
            ),
          BollingerBandSqueezeStrategy.COIN_CALCULATION_TIMEOUT_MS
        );
      });

      try {
        bbResult = await Promise.race([bbPromise, timeoutPromise]);
      } finally {
        clearTimeout(timerId);
      }
    } catch (err: unknown) {
      const errInfo = toErrorInfo(err);
      this.logger.error(
        `BB Squeeze: calculateBollingerBands failed for ${coin.symbol} ` +
          `(${priceHistory.length} prices, elapsed=${Date.now() - coinStart}ms): ${errInfo.message}`
      );
      return null;
    }

    const bbDuration = Date.now() - coinStart;
    if (bbDuration > 1000) {
      this.logger.warn(
        `BB Squeeze: slow calculateBollingerBands for ${coin.symbol}: ${bbDuration}ms ` +
          `(${priceHistory.length} prices, cached=${bbResult.fromCache})`
      );
    }

    return bbResult;
  }

  /**
   * Generate trading signal based on squeeze breakout
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: CandleData[],
    bands: BollingerBandsData,
    config: BollingerSqueezeConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (!Number.isFinite(bands.bandwidth[currentIndex]) || !Number.isFinite(bands.bandwidth[previousIndex])) {
      return null;
    }

    const squeezeState = this.analyzeSqueezeState(bands.bandwidth, config, currentIndex);

    const wasInSqueeze = squeezeState.squeezeBars >= config.minSqueezeBars;
    const isBreakingOut =
      bands.bandwidth[currentIndex] >= config.squeezeThreshold &&
      bands.bandwidth[previousIndex] < config.squeezeThreshold;

    if (!wasInSqueeze || !isBreakingOut) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const isBullishBreakout = currentPrice > bands.middle[currentIndex];

    if (config.breakoutConfirmation) {
      const priceChange = currentPrice - prices[previousIndex].avg;
      if (isBullishBreakout && priceChange <= 0) return null;
      if (!isBullishBreakout && priceChange >= 0) return null;
    }

    const strength = this.calculateSignalStrength(squeezeState, bands.bandwidth, currentIndex, config);
    const confidence = this.calculateConfidence(squeezeState, prices, bands, config, currentIndex, isBullishBreakout);

    return {
      type: isBullishBreakout ? SignalType.BUY : SignalType.SELL,
      coinId,
      strength,
      price: currentPrice,
      confidence,
      reason: `${isBullishBreakout ? 'Bullish' : 'Bearish'} squeeze breakout: ${squeezeState.squeezeBars} bars of low volatility (bandwidth < ${(config.squeezeThreshold * 100).toFixed(1)}%), price breaking ${isBullishBreakout ? 'above' : 'below'} middle band`,
      metadata: {
        symbol: coinSymbol,
        squeezeBars: squeezeState.squeezeBars,
        squeezeStartIndex: squeezeState.squeezeStartIndex,
        avgBandwidthDuringSqueeze: squeezeState.avgBandwidthDuringSqueeze,
        currentBandwidth: bands.bandwidth[currentIndex],
        upperBand: bands.upper[currentIndex],
        middleBand: bands.middle[currentIndex],
        lowerBand: bands.lower[currentIndex],
        percentB: bands.pb[currentIndex],
        breakoutType: isBullishBreakout ? 'bullish' : 'bearish'
      }
    };
  }

  /**
   * Calculate signal strength based on squeeze duration and bandwidth expansion
   */
  private calculateSignalStrength(
    squeezeState: SqueezeState,
    bandwidth: number[],
    currentIndex: number,
    config: BollingerSqueezeConfig
  ): number {
    // Longer squeezes typically lead to stronger breakouts
    const squeezeDurationScore = Math.min(1, squeezeState.squeezeBars / (config.minSqueezeBars * 2));

    // Tighter squeezes (lower bandwidth) lead to stronger breakouts
    const squeezeIntensityScore = Math.min(
      1,
      (config.squeezeThreshold - squeezeState.avgBandwidthDuringSqueeze) / (config.squeezeThreshold * 0.75)
    );

    // How much bandwidth expanded on breakout
    const bandwidthExpansion =
      squeezeState.avgBandwidthDuringSqueeze > 0 ? bandwidth[currentIndex] / squeezeState.avgBandwidthDuringSqueeze : 1;
    const expansionScore = Math.min(1, (bandwidthExpansion - 1) / 2);

    return Math.min(1, Math.max(0.4, (squeezeDurationScore + squeezeIntensityScore + expansionScore) / 3));
  }

  /**
   * Calculate confidence based on squeeze characteristics and breakout momentum
   */
  private calculateConfidence(
    squeezeState: SqueezeState,
    prices: CandleData[],
    bands: BollingerBandsData,
    config: BollingerSqueezeConfig,
    currentIndex: number,
    isBullish: boolean
  ): number {
    const durationConfidence = Math.min(1, squeezeState.squeezeBars / (config.minSqueezeBars * 2));

    let momentumScore = 0;
    if (currentIndex > 0) {
      const priceChange = Math.abs(prices[currentIndex].avg - prices[currentIndex - 1].avg);
      const avgPrice = prices[currentIndex].avg;
      momentumScore = Math.min(1, (priceChange / avgPrice) * 50);
    }

    let pbConfirmation = 0;
    if (Number.isFinite(bands.pb[currentIndex])) {
      if (isBullish && bands.pb[currentIndex] > 0.5) {
        pbConfirmation = (bands.pb[currentIndex] - 0.5) * 2;
      } else if (!isBullish && bands.pb[currentIndex] < 0.5) {
        pbConfirmation = (0.5 - bands.pb[currentIndex]) * 2;
      }
    }

    const baseConfidence = 0.5;
    return Math.min(1, baseConfidence + durationConfidence * 0.2 + momentumScore * 0.15 + pbConfirmation * 0.15);
  }

  /**
   * Prepare chart data with squeeze state indicators
   */
  private prepareChartData(
    prices: CandleData[],
    bands: BollingerBandsData,
    config: BollingerSqueezeConfig
  ): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        upperBand: bands.upper[index],
        middleBand: bands.middle[index],
        lowerBand: bands.lower[index],
        percentB: bands.pb[index],
        bandwidth: bands.bandwidth[index],
        isInSqueeze: Number.isFinite(bands.bandwidth[index]) && bands.bandwidth[index] < config.squeezeThreshold,
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
    const minSqueezeBars = (config.minSqueezeBars as number) ?? 4;
    return period + minSqueezeBars + 5;
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
      period: { type: 'number', default: 20, min: 10, max: 50, description: 'Bollinger Bands period' },
      stdDev: { type: 'number', default: 2, min: 1, max: 3, description: 'Standard deviation multiplier' },
      squeezeThreshold: {
        type: 'number',
        default: 0.05,
        min: 0.03,
        max: 0.1,
        description: 'Bandwidth threshold for squeeze (5% = 0.05)'
      },
      minSqueezeBars: {
        type: 'number',
        default: 4,
        min: 3,
        max: 20,
        description: 'Minimum bars in squeeze before breakout signal'
      },
      breakoutConfirmation: { type: 'boolean', default: true, description: 'Require price momentum confirmation' },
      minConfidence: { type: 'number', default: 0.5, min: 0, max: 1, description: 'Minimum confidence required' }
    };
  }

  /**
   * Enhanced validation for Bollinger Band Squeeze strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
