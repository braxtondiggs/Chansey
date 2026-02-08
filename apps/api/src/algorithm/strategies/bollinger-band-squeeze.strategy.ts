import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
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

  /**
   * Execute the Bollinger Band Squeeze strategy
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

        // Calculate Bollinger Bands using IndicatorService (with caching)
        const bbResult = await this.indicatorService.calculateBollingerBands(
          {
            coinId: coin.id,
            prices: priceHistory,
            period: config.period,
            stdDev: config.stdDev
          },
          this
        );

        const { upper, middle, lower, pb, bandwidth } = bbResult;

        // Analyze squeeze state and generate signals
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

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, upper, middle, lower, pb, bandwidth, config);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`Bollinger Band Squeeze strategy execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): BollingerSqueezeConfig {
    return {
      period: (config.period as number) || 20,
      stdDev: (config.stdDev as number) || 2,
      squeezeThreshold: (config.squeezeThreshold as number) || 0.04, // 4% bandwidth
      minSqueezeBars: (config.minSqueezeBars as number) || 6,
      breakoutConfirmation: (config.breakoutConfirmation as boolean) ?? true,
      minConfidence: (config.minConfidence as number) || 0.6
    };
  }

  /**
   * Check if we have enough data for squeeze detection
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: BollingerSqueezeConfig): boolean {
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
    for (let i = currentIndex - 1; i >= 0 && i >= currentIndex - config.minSqueezeBars - 5; i--) {
      if (isNaN(bandwidth[i])) continue;

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

    const isInSqueeze = !isNaN(bandwidth[currentIndex]) && bandwidth[currentIndex] < config.squeezeThreshold;
    const avgBandwidthDuringSqueeze = squeezeBars > 0 ? totalBandwidth / squeezeBars : 0;

    return {
      isInSqueeze,
      squeezeBars,
      squeezeStartIndex,
      avgBandwidthDuringSqueeze
    };
  }

  /**
   * Generate trading signal based on squeeze breakout
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    upper: number[],
    middle: number[],
    lower: number[],
    pb: number[],
    bandwidth: number[],
    config: BollingerSqueezeConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (isNaN(bandwidth[currentIndex]) || isNaN(bandwidth[previousIndex])) {
      return null;
    }

    // Analyze previous squeeze state
    const squeezeState = this.analyzeSqueezeState(bandwidth, config, currentIndex);

    // Check for squeeze breakout (was in squeeze, now breaking out)
    const wasInSqueeze = squeezeState.squeezeBars >= config.minSqueezeBars;
    const isBreakingOut =
      bandwidth[currentIndex] >= config.squeezeThreshold && bandwidth[previousIndex] < config.squeezeThreshold;

    if (!wasInSqueeze || !isBreakingOut) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const currentMiddle = middle[currentIndex];
    const currentUpper = upper[currentIndex];
    const currentLower = lower[currentIndex];
    const currentPB = pb[currentIndex];
    const currentBandwidth = bandwidth[currentIndex];

    // Determine breakout direction based on price position relative to middle band
    const isBullishBreakout = currentPrice > currentMiddle;

    // Optional confirmation: Price should be moving in breakout direction
    if (config.breakoutConfirmation) {
      const priceChange = currentPrice - prices[previousIndex].avg;
      if (isBullishBreakout && priceChange <= 0) {
        return null; // Price not confirming bullish breakout
      }
      if (!isBullishBreakout && priceChange >= 0) {
        return null; // Price not confirming bearish breakout
      }
    }

    const strength = this.calculateSignalStrength(squeezeState, bandwidth, currentIndex, isBullishBreakout);
    const confidence = this.calculateConfidence(
      squeezeState,
      prices,
      pb,
      bandwidth,
      config,
      currentIndex,
      isBullishBreakout
    );

    if (isBullishBreakout) {
      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Bullish squeeze breakout: ${squeezeState.squeezeBars} bars of low volatility (bandwidth < ${(config.squeezeThreshold * 100).toFixed(1)}%), price breaking above middle band`,
        metadata: {
          symbol: coinSymbol,
          squeezeBars: squeezeState.squeezeBars,
          squeezeStartIndex: squeezeState.squeezeStartIndex,
          avgBandwidthDuringSqueeze: squeezeState.avgBandwidthDuringSqueeze,
          currentBandwidth,
          upperBand: currentUpper,
          middleBand: currentMiddle,
          lowerBand: currentLower,
          percentB: currentPB,
          breakoutType: 'bullish'
        }
      };
    } else {
      return {
        type: SignalType.SELL,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Bearish squeeze breakout: ${squeezeState.squeezeBars} bars of low volatility (bandwidth < ${(config.squeezeThreshold * 100).toFixed(1)}%), price breaking below middle band`,
        metadata: {
          symbol: coinSymbol,
          squeezeBars: squeezeState.squeezeBars,
          squeezeStartIndex: squeezeState.squeezeStartIndex,
          avgBandwidthDuringSqueeze: squeezeState.avgBandwidthDuringSqueeze,
          currentBandwidth,
          upperBand: currentUpper,
          middleBand: currentMiddle,
          lowerBand: currentLower,
          percentB: currentPB,
          breakoutType: 'bearish'
        }
      };
    }
  }

  /**
   * Calculate signal strength based on squeeze duration and bandwidth expansion
   */
  private calculateSignalStrength(
    squeezeState: SqueezeState,
    bandwidth: number[],
    currentIndex: number,
    isBullish: boolean
  ): number {
    // Longer squeezes typically lead to stronger breakouts
    const squeezeDurationScore = Math.min(1, squeezeState.squeezeBars / 12); // 12 bars = max score

    // Tighter squeezes (lower bandwidth) lead to stronger breakouts
    const squeezeIntensityScore = Math.min(1, (0.04 - squeezeState.avgBandwidthDuringSqueeze) / 0.03);

    // How much bandwidth expanded on breakout
    const bandwidthExpansion = bandwidth[currentIndex] / squeezeState.avgBandwidthDuringSqueeze;
    const expansionScore = Math.min(1, (bandwidthExpansion - 1) / 2);

    return Math.min(1, Math.max(0.4, (squeezeDurationScore + squeezeIntensityScore + expansionScore) / 3));
  }

  /**
   * Calculate confidence based on squeeze characteristics and breakout momentum
   */
  private calculateConfidence(
    squeezeState: SqueezeState,
    prices: PriceSummary[],
    pb: number[],
    bandwidth: number[],
    config: BollingerSqueezeConfig,
    currentIndex: number,
    isBullish: boolean
  ): number {
    // Squeeze duration confidence (longer = more confident)
    const durationConfidence = Math.min(1, squeezeState.squeezeBars / (config.minSqueezeBars * 2));

    // Breakout momentum (how decisively price moved)
    let momentumScore = 0;
    if (currentIndex > 0) {
      const priceChange = Math.abs(prices[currentIndex].avg - prices[currentIndex - 1].avg);
      const avgPrice = prices[currentIndex].avg;
      momentumScore = Math.min(1, (priceChange / avgPrice) * 50); // 2% move = full score
    }

    // %B position confirmation
    let pbConfirmation = 0;
    if (!isNaN(pb[currentIndex])) {
      if (isBullish && pb[currentIndex] > 0.5) {
        pbConfirmation = (pb[currentIndex] - 0.5) * 2;
      } else if (!isBullish && pb[currentIndex] < 0.5) {
        pbConfirmation = (0.5 - pb[currentIndex]) * 2;
      }
    }

    // Base confidence for squeeze breakouts
    const baseConfidence = 0.5;

    return Math.min(1, baseConfidence + durationConfidence * 0.2 + momentumScore * 0.15 + pbConfirmation * 0.15);
  }

  /**
   * Prepare chart data with squeeze state indicators
   */
  private prepareChartData(
    prices: PriceSummary[],
    upper: number[],
    middle: number[],
    lower: number[],
    pb: number[],
    bandwidth: number[],
    config: BollingerSqueezeConfig
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
        isInSqueeze: !isNaN(bandwidth[index]) && bandwidth[index] < config.squeezeThreshold,
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
      period: { type: 'number', default: 20, min: 10, max: 50, description: 'Bollinger Bands period' },
      stdDev: { type: 'number', default: 2, min: 1, max: 3, description: 'Standard deviation multiplier' },
      squeezeThreshold: {
        type: 'number',
        default: 0.04,
        min: 0.01,
        max: 0.1,
        description: 'Bandwidth threshold for squeeze (4% = 0.04)'
      },
      minSqueezeBars: {
        type: 'number',
        default: 6,
        min: 3,
        max: 20,
        description: 'Minimum bars in squeeze before breakout signal'
      },
      breakoutConfirmation: { type: 'boolean', default: true, description: 'Require price momentum confirmation' },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1, description: 'Minimum confidence required' }
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
