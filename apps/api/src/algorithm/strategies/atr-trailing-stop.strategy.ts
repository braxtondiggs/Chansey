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

        // Generate entry signals based on trend-flip detection, then stop signals
        if (config.tradeDirection === 'long' || config.tradeDirection === 'both') {
          const longEntry = this.generateLongEntrySignal(coin.id, coin.symbol, priceHistory, atr, config);
          if (longEntry && longEntry.confidence >= config.minConfidence) {
            signals.push(longEntry);
          }

          const longSignal = this.generateLongStopSignal(coin.id, coin.symbol, priceHistory, atr, config);
          if (longSignal && longSignal.confidence >= config.minConfidence) {
            signals.push(longSignal);
          }
        }

        if (config.tradeDirection === 'short' || config.tradeDirection === 'both') {
          const shortEntry = this.generateShortEntrySignal(coin.id, coin.symbol, priceHistory, atr, config);
          if (shortEntry && shortEntry.confidence >= config.minConfidence) {
            signals.push(shortEntry);
          }

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
      atrPeriod: (config.atrPeriod as number) ?? 14,
      atrMultiplier: (config.atrMultiplier as number) ?? 2.5,
      tradeDirection: (config.tradeDirection as 'long' | 'short' | 'both') ?? 'long',
      useHighLow: (config.useHighLow as boolean) ?? true,
      minConfidence: (config.minConfidence as number) ?? 0.6
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
    const prevATR = !isNaN(atr[currentIndex - 1]) ? atr[currentIndex - 1] : currentATR;
    const previousStopLevel = previousHighestHigh - prevATR * config.atrMultiplier;

    // Ratchet: trailing stop should only move up for longs
    const rawStopLevel = stopLevel;
    const ratchetedStopLevel = isNaN(previousStopLevel) ? rawStopLevel : Math.max(rawStopLevel, previousStopLevel);

    // Check if stop is triggered (price dropped below trailing stop)
    const isTriggered = currentPrice < ratchetedStopLevel;

    return {
      stopLevel: ratchetedStopLevel,
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
    const prevATR = !isNaN(atr[currentIndex - 1]) ? atr[currentIndex - 1] : currentATR;
    const previousStopLevel = previousLowestLow + prevATR * config.atrMultiplier;

    // Ratchet: trailing stop should only move down for shorts
    const rawStopLevel = stopLevel;
    const ratchetedStopLevel = isNaN(previousStopLevel) ? rawStopLevel : Math.min(rawStopLevel, previousStopLevel);

    // Check if stop is triggered (price rose above trailing stop for shorts)
    const isTriggered = currentPrice > ratchetedStopLevel;

    return {
      stopLevel: ratchetedStopLevel,
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
    const triggerPrice = config.useHighLow ? prices[currentIndex].low : prices[currentIndex].avg;
    const currentATR = atr[currentIndex];

    if (stopState.isTriggered) {
      const strength = this.calculateSignalStrength(triggerPrice, stopState.stopLevel, currentATR);
      const confidence = this.calculateConfidence(prices, atr, stopState, config, 'long');

      return {
        type: SignalType.STOP_LOSS,
        coinId,
        strength,
        price: stopState.stopLevel,
        confidence,
        reason: `Long trailing stop triggered: Price (${triggerPrice.toFixed(2)}) fell below stop (${stopState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
        metadata: {
          symbol: coinSymbol,
          currentPrice: triggerPrice,
          avgPrice: prices[currentIndex].avg,
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
    const triggerPrice = config.useHighLow ? prices[currentIndex].high : prices[currentIndex].avg;
    const currentATR = atr[currentIndex];

    if (stopState.isTriggered) {
      const strength = this.calculateSignalStrength(triggerPrice, stopState.stopLevel, currentATR);
      const confidence = this.calculateConfidence(prices, atr, stopState, config, 'short');

      return {
        type: SignalType.STOP_LOSS,
        coinId,
        strength,
        price: stopState.stopLevel,
        confidence,
        reason: `Short trailing stop triggered: Price (${triggerPrice.toFixed(2)}) rose above stop (${stopState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
        metadata: {
          symbol: coinSymbol,
          currentPrice: triggerPrice,
          avgPrice: prices[currentIndex].avg,
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
   * Generate BUY entry signal for long positions on bullish trend flip.
   * A trend flip occurs when the previous bar was below the trailing stop
   * (triggered) but the current bar is above it (no longer triggered).
   */
  private generateLongEntrySignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    atr: number[],
    config: ATRTrailingStopConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    if (currentIndex < 1) return null;

    const lookbackStart = Math.max(0, currentIndex - config.atrPeriod);

    if (isNaN(atr[currentIndex]) || isNaN(atr[currentIndex - 1])) {
      return null;
    }

    // Check current bar: not triggered (price above stop)
    const currentState = this.calculateLongTrailingStop(prices, atr, config, lookbackStart, currentIndex);
    if (currentState.isTriggered) return null;

    // Check previous bar: was triggered (price below stop)
    const prevLookbackStart = Math.max(0, currentIndex - 1 - config.atrPeriod);
    const prevState = this.calculateLongTrailingStop(prices, atr, config, prevLookbackStart, currentIndex - 1);
    if (!prevState.isTriggered) return null;

    // Trend flip detected: price transitioned from below to above trailing stop
    const currentPrice = prices[currentIndex].avg;
    const currentATR = atr[currentIndex];
    const strength = this.calculateEntryStrength(currentPrice, currentState.stopLevel, currentATR);
    const confidence = this.calculateEntryConfidence(prices, atr);

    return {
      type: SignalType.BUY,
      coinId,
      strength,
      price: currentPrice,
      confidence,
      reason: `Long entry: Bullish trend flip detected. Price (${currentPrice.toFixed(2)}) recovered above trailing stop (${currentState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
      metadata: {
        symbol: coinSymbol,
        currentPrice,
        stopLevel: currentState.stopLevel,
        atr: currentATR,
        atrMultiplier: config.atrMultiplier,
        direction: 'long',
        signalSource: 'trend_flip'
      }
    };
  }

  /**
   * Generate SELL entry signal for short positions on bearish trend flip.
   * A trend flip occurs when the previous bar was above the trailing stop
   * (triggered for shorts) but the current bar is below it.
   */
  private generateShortEntrySignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    atr: number[],
    config: ATRTrailingStopConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    if (currentIndex < 1) return null;

    const lookbackStart = Math.max(0, currentIndex - config.atrPeriod);

    if (isNaN(atr[currentIndex]) || isNaN(atr[currentIndex - 1])) {
      return null;
    }

    // Check current bar: not triggered (price below short stop)
    const currentState = this.calculateShortTrailingStop(prices, atr, config, lookbackStart, currentIndex);
    if (currentState.isTriggered) return null;

    // Check previous bar: was triggered (price above short stop)
    const prevLookbackStart = Math.max(0, currentIndex - 1 - config.atrPeriod);
    const prevState = this.calculateShortTrailingStop(prices, atr, config, prevLookbackStart, currentIndex - 1);
    if (!prevState.isTriggered) return null;

    // Bearish trend flip detected
    const currentPrice = prices[currentIndex].avg;
    const currentATR = atr[currentIndex];
    const strength = this.calculateEntryStrength(currentPrice, currentState.stopLevel, currentATR);
    const confidence = this.calculateEntryConfidence(prices, atr);

    return {
      type: SignalType.SELL,
      coinId,
      strength,
      price: currentPrice,
      confidence,
      reason: `Short entry: Bearish trend flip detected. Price (${currentPrice.toFixed(2)}) dropped below trailing stop (${currentState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
      metadata: {
        symbol: coinSymbol,
        currentPrice,
        stopLevel: currentState.stopLevel,
        atr: currentATR,
        atrMultiplier: config.atrMultiplier,
        direction: 'short',
        signalSource: 'trend_flip'
      }
    };
  }

  /**
   * Calculate entry signal strength based on price-to-stop buffer relative to ATR.
   * Larger buffer from the stop = stronger entry signal.
   */
  private calculateEntryStrength(currentPrice: number, stopLevel: number, atr: number): number {
    if (atr === 0) return 0.5;
    const buffer = Math.abs(currentPrice - stopLevel);
    const bufferRatio = buffer / atr;
    return Math.min(1, Math.max(0.3, bufferRatio * 0.5));
  }

  /**
   * Calculate entry confidence based on ATR stability.
   * More stable ATR = more reliable entry signals.
   */
  private calculateEntryConfidence(prices: PriceSummary[], atr: number[]): number {
    const currentIndex = prices.length - 1;
    const lookback = 5;
    const startIndex = Math.max(0, currentIndex - lookback);

    let atrSum = 0;
    let count = 0;
    for (let i = startIndex; i <= currentIndex; i++) {
      if (!isNaN(atr[i])) {
        atrSum += atr[i];
        count++;
      }
    }
    const avgATR = count > 0 ? atrSum / count : atr[currentIndex];

    if (!avgATR || avgATR === 0) {
      return 0.45;
    }

    let atrVariation = 0;
    for (let i = startIndex; i <= currentIndex; i++) {
      if (!isNaN(atr[i])) {
        atrVariation += Math.abs(atr[i] - avgATR) / avgATR;
      }
    }
    const atrStability = 1 - Math.min(1, count > 0 ? atrVariation / count : 0);

    const baseConfidence = 0.45;
    return Math.min(1, baseConfidence + atrStability * 0.35);
  }

  /**
   * Calculate signal strength based on how far price breached stop
   */
  private calculateSignalStrength(currentPrice: number, stopLevel: number, atr: number): number {
    if (atr === 0) return 0.5;
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
    if (!avgATR || avgATR === 0) {
      return 0.5;
    }
    for (let i = startIndex; i <= currentIndex; i++) {
      if (!isNaN(atr[i])) {
        atrVariation += Math.abs(atr[i] - avgATR) / avgATR;
      }
    }
    const atrStability = 1 - Math.min(1, count > 0 ? atrVariation / count : 0);

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
