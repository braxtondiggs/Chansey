import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface BollingerBreakoutConfig {
  period: number;
  stdDev: number;
  requireConfirmation: boolean;
  confirmationBars: number;
  minConfidence: number;
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

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, upper, middle, lower, pb, bandwidth);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`Bollinger Bands Breakout strategy execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): BollingerBreakoutConfig {
    return {
      period: (config.period as number) ?? 20,
      stdDev: (config.stdDev as number) ?? 2,
      requireConfirmation: (config.requireConfirmation as boolean) ?? false,
      confirmationBars: (config.confirmationBars as number) ?? 2,
      minConfidence: (config.minConfidence as number) ?? 0.6
    };
  }

  /**
   * Check if we have enough data for Bollinger Bands calculation
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: BollingerBreakoutConfig): boolean {
    const minRequired = config.period + (config.requireConfirmation ? config.confirmationBars : 1);
    return !!priceHistory && priceHistory.length >= minRequired;
  }

  /**
   * Generate trading signal based on Bollinger Bands breakout
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
    config: BollingerBreakoutConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;

    if (isNaN(upper[currentIndex]) || isNaN(lower[currentIndex]) || isNaN(pb[currentIndex])) {
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
      if (confirmed.direction === 'bullish' && currentPB < 0) return null;
      if (confirmed.direction === 'bearish' && currentPB > 1) return null;
    }

    // Bullish breakout: Price above upper band (%B > 1)
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

    // Bearish breakout: Price below lower band (%B < 0)
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

    return null;
  }

  /**
   * Check if breakout is confirmed over multiple bars
   */
  private checkConfirmation(
    prices: PriceSummary[],
    upper: number[],
    lower: number[],
    config: BollingerBreakoutConfig,
    currentIndex: number
  ): { isConfirmed: boolean; direction: 'bullish' | 'bearish' | null } {
    let bullishCount = 0;
    let bearishCount = 0;

    for (let i = currentIndex - config.confirmationBars + 1; i <= currentIndex; i++) {
      if (i < 0 || isNaN(upper[i]) || isNaN(lower[i])) continue;

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
    prices: PriceSummary[],
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
      if (!isNaN(bandwidth[i]) && !isNaN(bandwidth[i - 1]) && bandwidth[i] > bandwidth[i - 1]) {
        bandwidthExpanding++;
      }
    }

    // Check momentum consistency
    let momentumConsistent = 0;
    for (let i = startIndex + 1; i <= currentIndex; i++) {
      if (!isNaN(pb[i]) && !isNaN(pb[i - 1])) {
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
    prices: PriceSummary[],
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
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      period: { type: 'number', default: 20, min: 10, max: 50, description: 'Bollinger Bands period' },
      stdDev: { type: 'number', default: 2, min: 1, max: 3, description: 'Standard deviation multiplier' },
      requireConfirmation: { type: 'boolean', default: false, description: 'Require multiple bars confirmation' },
      confirmationBars: { type: 'number', default: 2, min: 1, max: 5, description: 'Number of bars for confirmation' },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1, description: 'Minimum confidence required' }
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
