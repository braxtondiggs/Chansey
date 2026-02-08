import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface ATRTrailingStopConfig {
  atrPeriod: number;
  atrMultiplier: number;
  tradeDirection: 'long' | 'short' | 'both';
  useHighLow: boolean;
  minConfidence: number;
}

interface TrailingStopState {
  stopLevel: number;
  previousStopLevel: number;
  isTriggered: boolean;
  triggerType: 'stop_loss' | 'take_profit' | null;
}

/**
 * ATR Trailing Stop Strategy
 *
 * Dynamic stop-loss signals based on Average True Range.
 * Adapts stop distance to market volatility for better risk management.
 *
 * For long positions: Stop = Highest High - (ATR * multiplier)
 * For short positions: Stop = Lowest Low + (ATR * multiplier)
 *
 * Generates STOP_LOSS or TAKE_PROFIT signals when price breaches trailing stop.
 *
 * Uses centralized IndicatorService for ATR calculations with caching.
 */
@Injectable()
export class ATRTrailingStopStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'atr-trailing-stop-001';

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
   * Execute the ATR Trailing Stop strategy
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

        // Calculate ATR using IndicatorService (with caching)
        const atrResult = await this.indicatorService.calculateATR(
          { coinId: coin.id, prices: priceHistory, period: config.atrPeriod },
          this
        );

        const atr = atrResult.values;

        // Generate signals based on trailing stop logic
        if (config.tradeDirection === 'long' || config.tradeDirection === 'both') {
          const longSignal = this.generateLongStopSignal(coin.id, coin.symbol, priceHistory, atr, config);
          if (longSignal && longSignal.confidence >= config.minConfidence) {
            signals.push(longSignal);
          }
        }

        if (config.tradeDirection === 'short' || config.tradeDirection === 'both') {
          const shortSignal = this.generateShortStopSignal(coin.id, coin.symbol, priceHistory, atr, config);
          if (shortSignal && shortSignal.confidence >= config.minConfidence) {
            signals.push(shortSignal);
          }
        }

        // Prepare chart data with trailing stop levels
        chartData[coin.id] = this.prepareChartData(priceHistory, atr, config);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`ATR Trailing Stop strategy execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): ATRTrailingStopConfig {
    return {
      atrPeriod: (config.atrPeriod as number) || 14,
      atrMultiplier: (config.atrMultiplier as number) || 2.5,
      tradeDirection: (config.tradeDirection as 'long' | 'short' | 'both') || 'long',
      useHighLow: (config.useHighLow as boolean) ?? true,
      minConfidence: (config.minConfidence as number) || 0.6
    };
  }

  /**
   * Check if we have enough data for ATR calculation
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: ATRTrailingStopConfig): boolean {
    return !!priceHistory && priceHistory.length >= config.atrPeriod + 5;
  }

  /**
   * Calculate trailing stop level for long positions
   */
  private calculateLongTrailingStop(
    prices: PriceSummary[],
    atr: number[],
    config: ATRTrailingStopConfig,
    lookbackStart: number,
    currentIndex: number
  ): TrailingStopState {
    // Find highest high in the lookback period
    let highestHigh = -Infinity;
    for (let i = lookbackStart; i <= currentIndex; i++) {
      const high = config.useHighLow ? prices[i].high : prices[i].avg;
      if (high > highestHigh) {
        highestHigh = high;
      }
    }

    const currentATR = atr[currentIndex];
    const currentPrice = config.useHighLow ? prices[currentIndex].low : prices[currentIndex].avg;
    const stopLevel = highestHigh - currentATR * config.atrMultiplier;

    // Calculate previous stop level for comparison
    let previousHighestHigh = -Infinity;
    for (let i = lookbackStart; i < currentIndex; i++) {
      const high = config.useHighLow ? prices[i].high : prices[i].avg;
      if (high > previousHighestHigh) {
        previousHighestHigh = high;
      }
    }
    const previousStopLevel = previousHighestHigh - atr[currentIndex - 1] * config.atrMultiplier;

    // Check if stop is triggered (price dropped below trailing stop)
    const isTriggered = currentPrice < stopLevel;

    return {
      stopLevel,
      previousStopLevel,
      isTriggered,
      triggerType: isTriggered ? 'stop_loss' : null
    };
  }

  /**
   * Calculate trailing stop level for short positions
   */
  private calculateShortTrailingStop(
    prices: PriceSummary[],
    atr: number[],
    config: ATRTrailingStopConfig,
    lookbackStart: number,
    currentIndex: number
  ): TrailingStopState {
    // Find lowest low in the lookback period
    let lowestLow = Infinity;
    for (let i = lookbackStart; i <= currentIndex; i++) {
      const low = config.useHighLow ? prices[i].low : prices[i].avg;
      if (low < lowestLow) {
        lowestLow = low;
      }
    }

    const currentATR = atr[currentIndex];
    const currentPrice = config.useHighLow ? prices[currentIndex].high : prices[currentIndex].avg;
    const stopLevel = lowestLow + currentATR * config.atrMultiplier;

    // Calculate previous stop level for comparison
    let previousLowestLow = Infinity;
    for (let i = lookbackStart; i < currentIndex; i++) {
      const low = config.useHighLow ? prices[i].low : prices[i].avg;
      if (low < previousLowestLow) {
        previousLowestLow = low;
      }
    }
    const previousStopLevel = previousLowestLow + atr[currentIndex - 1] * config.atrMultiplier;

    // Check if stop is triggered (price rose above trailing stop for shorts)
    const isTriggered = currentPrice > stopLevel;

    return {
      stopLevel,
      previousStopLevel,
      isTriggered,
      triggerType: isTriggered ? 'stop_loss' : null
    };
  }

  /**
   * Generate stop signal for long positions
   */
  private generateLongStopSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    atr: number[],
    config: ATRTrailingStopConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const lookbackStart = Math.max(0, currentIndex - config.atrPeriod);

    if (isNaN(atr[currentIndex])) {
      return null;
    }

    const stopState = this.calculateLongTrailingStop(prices, atr, config, lookbackStart, currentIndex);
    const currentPrice = prices[currentIndex].avg;
    const currentATR = atr[currentIndex];

    if (stopState.isTriggered) {
      const strength = this.calculateSignalStrength(currentPrice, stopState.stopLevel, currentATR, 'long');
      const confidence = this.calculateConfidence(prices, atr, stopState, config, 'long');

      return {
        type: SignalType.STOP_LOSS,
        coinId,
        strength,
        price: stopState.stopLevel,
        confidence,
        reason: `Long trailing stop triggered: Price (${currentPrice.toFixed(2)}) fell below stop (${stopState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
        metadata: {
          symbol: coinSymbol,
          currentPrice,
          stopLevel: stopState.stopLevel,
          previousStopLevel: stopState.previousStopLevel,
          atr: currentATR,
          atrMultiplier: config.atrMultiplier,
          direction: 'long',
          stopType: 'trailing'
        }
      };
    }

    return null;
  }

  /**
   * Generate stop signal for short positions
   */
  private generateShortStopSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    atr: number[],
    config: ATRTrailingStopConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const lookbackStart = Math.max(0, currentIndex - config.atrPeriod);

    if (isNaN(atr[currentIndex])) {
      return null;
    }

    const stopState = this.calculateShortTrailingStop(prices, atr, config, lookbackStart, currentIndex);
    const currentPrice = prices[currentIndex].avg;
    const currentATR = atr[currentIndex];

    if (stopState.isTriggered) {
      const strength = this.calculateSignalStrength(currentPrice, stopState.stopLevel, currentATR, 'short');
      const confidence = this.calculateConfidence(prices, atr, stopState, config, 'short');

      return {
        type: SignalType.STOP_LOSS,
        coinId,
        strength,
        price: stopState.stopLevel,
        confidence,
        reason: `Short trailing stop triggered: Price (${currentPrice.toFixed(2)}) rose above stop (${stopState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
        metadata: {
          symbol: coinSymbol,
          currentPrice,
          stopLevel: stopState.stopLevel,
          previousStopLevel: stopState.previousStopLevel,
          atr: currentATR,
          atrMultiplier: config.atrMultiplier,
          direction: 'short',
          stopType: 'trailing'
        }
      };
    }

    return null;
  }

  /**
   * Calculate signal strength based on how far price breached stop
   */
  private calculateSignalStrength(
    currentPrice: number,
    stopLevel: number,
    atr: number,
    direction: 'long' | 'short'
  ): number {
    const breachAmount = Math.abs(currentPrice - stopLevel);
    const breachRatio = breachAmount / atr;

    // Strength is based on how significantly the stop was breached
    return Math.min(1, Math.max(0.4, breachRatio));
  }

  /**
   * Calculate confidence based on ATR stability and price momentum
   */
  private calculateConfidence(
    prices: PriceSummary[],
    atr: number[],
    stopState: TrailingStopState,
    config: ATRTrailingStopConfig,
    direction: 'long' | 'short'
  ): number {
    const currentIndex = prices.length - 1;
    const lookback = 5;
    const startIndex = Math.max(0, currentIndex - lookback);

    // Check ATR stability (less volatile ATR = more reliable stops)
    let atrVariation = 0;
    let atrSum = 0;
    let count = 0;
    for (let i = startIndex; i <= currentIndex; i++) {
      if (!isNaN(atr[i])) {
        atrSum += atr[i];
        count++;
      }
    }
    const avgATR = count > 0 ? atrSum / count : atr[currentIndex];
    for (let i = startIndex; i <= currentIndex; i++) {
      if (!isNaN(atr[i])) {
        atrVariation += Math.abs(atr[i] - avgATR) / avgATR;
      }
    }
    const atrStability = 1 - Math.min(1, atrVariation / lookback);

    // Check if stop level has been rising (for longs) or falling (for shorts)
    let stopProgression = 0;
    if (stopState.stopLevel > stopState.previousStopLevel && direction === 'long') {
      stopProgression = 0.2; // Stop was raising (good for longs)
    } else if (stopState.stopLevel < stopState.previousStopLevel && direction === 'short') {
      stopProgression = 0.2; // Stop was lowering (good for shorts)
    }

    // Base confidence for triggered stops
    const baseConfidence = 0.5;

    return Math.min(1, baseConfidence + atrStability * 0.3 + stopProgression);
  }

  /**
   * Prepare chart data with trailing stop levels
   */
  private prepareChartData(prices: PriceSummary[], atr: number[], config: ATRTrailingStopConfig): ChartDataPoint[] {
    return prices.map((price, index) => {
      // Calculate trailing stop at each point
      let longStop: number | undefined;
      let shortStop: number | undefined;

      if (!isNaN(atr[index])) {
        const lookbackStart = Math.max(0, index - config.atrPeriod);

        // Long trailing stop
        let highestHigh = -Infinity;
        for (let i = lookbackStart; i <= index; i++) {
          const high = config.useHighLow ? prices[i].high : prices[i].avg;
          if (high > highestHigh) highestHigh = high;
        }
        longStop = highestHigh - atr[index] * config.atrMultiplier;

        // Short trailing stop
        let lowestLow = Infinity;
        for (let i = lookbackStart; i <= index; i++) {
          const low = config.useHighLow ? prices[i].low : prices[i].avg;
          if (low < lowestLow) lowestLow = low;
        }
        shortStop = lowestLow + atr[index] * config.atrMultiplier;
      }

      return {
        timestamp: price.date,
        value: price.avg,
        metadata: {
          atr: atr[index],
          longTrailingStop: longStop,
          shortTrailingStop: shortStop,
          high: price.high,
          low: price.low
        }
      };
    });
  }

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      atrPeriod: { type: 'number', default: 14, min: 5, max: 30, description: 'ATR calculation period' },
      atrMultiplier: { type: 'number', default: 2.5, min: 1, max: 5, description: 'ATR multiplier for stop distance' },
      tradeDirection: {
        type: 'string',
        enum: ['long', 'short', 'both'],
        default: 'long',
        description: 'Which direction to generate stops for'
      },
      useHighLow: { type: 'boolean', default: true, description: 'Use high/low vs close for calculations' },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1, description: 'Minimum confidence required' }
    };
  }

  /**
   * Enhanced validation for ATR Trailing Stop strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
