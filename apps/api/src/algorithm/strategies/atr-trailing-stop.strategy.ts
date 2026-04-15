import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CandleData } from '../../ohlc/ohlc-candle.entity';
import {
  ExitConfig,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../../order/interfaces/exit-config.interface';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorRequirement, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

type Direction = 'long' | 'short';

interface ATRTrailingStopConfig {
  atrPeriod: number;
  atrMultiplier: number;
  tradeDirection: 'long' | 'short' | 'both';
  useHighLow: boolean;
  minConfidence: number;
  stopCooldownBars: number;
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

  getCustomCalculator<T extends keyof IndicatorCalculatorMap>(
    _indicatorType: T
  ): IndicatorCalculatorMap[T] | undefined {
    return undefined;
  }

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

      const directions: Direction[] = config.tradeDirection === 'both' ? ['long', 'short'] : [config.tradeDirection];

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, config)) {
          this.logger.debug(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        const atr =
          this.getPrecomputedSlice(context, coin.id, `atr_${config.atrPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateATR(
              { coinId: coin.id, prices: priceHistory, period: config.atrPeriod },
              this
            )
          ).values;

        const exitConfig = this.buildExitConfig(config);

        for (const direction of directions) {
          const entry = this.generateEntrySignal(coin.id, coin.symbol, priceHistory, atr, config, direction);
          if (entry && entry.confidence >= config.minConfidence) {
            // Suppress entry if a stop was triggered within the cooldown window
            if (
              config.stopCooldownBars > 0 &&
              this.wasStopTriggeredRecently(priceHistory, atr, config, direction, config.stopCooldownBars)
            ) {
              continue;
            }
            entry.exitConfig = exitConfig;
            signals.push(entry);
          }

          const stop = this.generateStopSignal(coin.id, coin.symbol, priceHistory, atr, config, direction);
          if (stop && stop.confidence >= config.minConfidence) {
            signals.push(stop);
          }
        }

        if (!isBacktest) {
          chartData[coin.id] = this.prepareChartData(priceHistory, atr, config);
        }
      }

      const resultExitConfig = this.buildExitConfig(this.getConfigWithDefaults(context.config));
      return this.createSuccessResult(
        signals,
        chartData,
        { algorithm: this.name, version: this.version, signalsGenerated: signals.length },
        resultExitConfig
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`ATR Trailing Stop strategy execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  private buildExitConfig(config: ATRTrailingStopConfig): Partial<ExitConfig> {
    return {
      enableStopLoss: true,
      stopLossType: StopLossType.ATR,
      stopLossValue: config.atrMultiplier,
      enableTakeProfit: true,
      takeProfitType: TakeProfitType.RISK_REWARD,
      takeProfitValue: 2, // 2:1 risk-reward
      atrPeriod: config.atrPeriod,
      atrMultiplier: config.atrMultiplier,
      enableTrailingStop: true,
      trailingType: TrailingType.ATR,
      trailingValue: config.atrMultiplier,
      trailingActivation: TrailingActivationType.PERCENTAGE,
      trailingActivationValue: 1, // Activate at 1% profit
      useOco: true
    };
  }

  private getConfigWithDefaults(config: Record<string, unknown>): ATRTrailingStopConfig {
    return {
      atrPeriod: Math.max(14, Math.min(25, (config.atrPeriod as number) ?? 20)),
      atrMultiplier: Math.max(3.5, Math.min(6, (config.atrMultiplier as number) ?? 4.5)),
      tradeDirection: (config.tradeDirection as 'long' | 'short' | 'both') ?? 'long',
      useHighLow: (config.useHighLow as boolean) ?? true,
      minConfidence: (config.minConfidence as number) ?? 0.4,
      stopCooldownBars: Math.max(0, Math.min(10, (config.stopCooldownBars as number) ?? 3))
    };
  }

  private hasEnoughData(priceHistory: CandleData[] | undefined, config: ATRTrailingStopConfig): boolean {
    return !!priceHistory && priceHistory.length >= config.atrPeriod + 5;
  }

  /**
   * Find the extremum (highest high for long, lowest low for short) in a price range.
   */
  private findExtremum(
    prices: CandleData[],
    config: ATRTrailingStopConfig,
    direction: Direction,
    from: number,
    to: number
  ): number {
    const isLong = direction === 'long';
    let extremum = isLong ? -Infinity : Infinity;
    for (let i = from; i <= to; i++) {
      const value = config.useHighLow ? (isLong ? prices[i].high : prices[i].low) : prices[i].avg;
      if (isLong ? value > extremum : value < extremum) {
        extremum = value;
      }
    }
    return extremum;
  }

  /**
   * Calculate trailing stop level for a given direction.
   */
  private calculateTrailingStop(
    prices: CandleData[],
    atr: number[],
    config: ATRTrailingStopConfig,
    lookbackStart: number,
    currentIndex: number,
    direction: Direction
  ): TrailingStopState {
    const isLong = direction === 'long';
    const extremum = this.findExtremum(prices, config, direction, lookbackStart, currentIndex);

    const currentATR = atr[currentIndex];
    const currentPrice = config.useHighLow
      ? isLong
        ? prices[currentIndex].low
        : prices[currentIndex].high
      : prices[currentIndex].avg;
    const stopLevel = isLong
      ? extremum - currentATR * config.atrMultiplier
      : extremum + currentATR * config.atrMultiplier;

    // Calculate previous stop level for comparison
    const prevExtremum = this.findExtremum(prices, config, direction, lookbackStart, currentIndex - 1);
    const prevATR = Number.isFinite(atr[currentIndex - 1]) ? atr[currentIndex - 1] : currentATR;
    const previousStopLevel = isLong
      ? prevExtremum - prevATR * config.atrMultiplier
      : prevExtremum + prevATR * config.atrMultiplier;

    // Ratchet: trailing stop should only move in the favorable direction
    const ratchetedStopLevel = !Number.isFinite(previousStopLevel)
      ? stopLevel
      : isLong
        ? Math.max(stopLevel, previousStopLevel)
        : Math.min(stopLevel, previousStopLevel);

    const isTriggered = isLong ? currentPrice < ratchetedStopLevel : currentPrice > ratchetedStopLevel;

    return {
      stopLevel: ratchetedStopLevel,
      previousStopLevel,
      isTriggered,
      triggerType: isTriggered ? 'stop_loss' : null
    };
  }

  /**
   * Check if a stop was triggered on any of the previous N bars for this direction.
   * Prevents rapid re-entry after a stop loss fires.
   */
  private wasStopTriggeredRecently(
    prices: CandleData[],
    atr: number[],
    config: ATRTrailingStopConfig,
    direction: Direction,
    cooldownBars: number
  ): boolean {
    const currentIndex = prices.length - 1;
    for (let i = 1; i <= cooldownBars && currentIndex - i >= config.atrPeriod; i++) {
      const barIndex = currentIndex - i;
      if (!Number.isFinite(atr[barIndex])) continue;
      const lookbackStart = Math.max(0, barIndex - config.atrPeriod);
      const state = this.calculateTrailingStop(prices, atr, config, lookbackStart, barIndex, direction);
      if (state.isTriggered) return true;
    }
    return false;
  }

  /**
   * Generate stop signal for a given direction.
   */
  private generateStopSignal(
    coinId: string,
    coinSymbol: string,
    prices: CandleData[],
    atr: number[],
    config: ATRTrailingStopConfig,
    direction: Direction
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const lookbackStart = Math.max(0, currentIndex - config.atrPeriod);

    if (!Number.isFinite(atr[currentIndex])) return null;

    const stopState = this.calculateTrailingStop(prices, atr, config, lookbackStart, currentIndex, direction);
    const isLong = direction === 'long';
    const triggerPrice = config.useHighLow
      ? isLong
        ? prices[currentIndex].low
        : prices[currentIndex].high
      : prices[currentIndex].avg;
    const currentATR = atr[currentIndex];

    if (!stopState.isTriggered) return null;

    const strength = this.calculateSignalStrength(triggerPrice, stopState.stopLevel, currentATR);
    const confidence = this.calculateConfidence(prices, atr, stopState, direction);
    const action = isLong ? 'fell below' : 'rose above';

    return {
      type: SignalType.STOP_LOSS,
      coinId,
      strength,
      price: stopState.stopLevel,
      confidence,
      reason: `${isLong ? 'Long' : 'Short'} trailing stop triggered: Price (${triggerPrice.toFixed(2)}) ${action} stop (${stopState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
      metadata: {
        symbol: coinSymbol,
        currentPrice: triggerPrice,
        avgPrice: prices[currentIndex].avg,
        stopLevel: stopState.stopLevel,
        previousStopLevel: stopState.previousStopLevel,
        atr: currentATR,
        atrMultiplier: config.atrMultiplier,
        direction,
        stopType: 'trailing'
      }
    };
  }

  /**
   * Generate entry signal for a given direction based on trend-flip detection.
   * A trend flip occurs when the previous bar was triggered but the current bar is not.
   */
  private generateEntrySignal(
    coinId: string,
    coinSymbol: string,
    prices: CandleData[],
    atr: number[],
    config: ATRTrailingStopConfig,
    direction: Direction
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    if (currentIndex < 1) return null;

    const lookbackStart = Math.max(0, currentIndex - config.atrPeriod);
    if (!Number.isFinite(atr[currentIndex]) || !Number.isFinite(atr[currentIndex - 1])) return null;

    const currentState = this.calculateTrailingStop(prices, atr, config, lookbackStart, currentIndex, direction);
    if (currentState.isTriggered) return null;

    const prevLookbackStart = Math.max(0, currentIndex - 1 - config.atrPeriod);
    const prevState = this.calculateTrailingStop(prices, atr, config, prevLookbackStart, currentIndex - 1, direction);
    if (!prevState.isTriggered) return null;

    const isLong = direction === 'long';
    const currentPrice = prices[currentIndex].avg;
    const currentATR = atr[currentIndex];
    const strength = this.calculateEntryStrength(currentPrice, currentState.stopLevel, currentATR);
    const confidence = this.calculateEntryConfidence(atr, currentIndex);
    const flipDesc = isLong ? 'Bullish trend flip detected. Price' : 'Bearish trend flip detected. Price';
    const action = isLong ? 'recovered above' : 'dropped below';

    return {
      type: isLong ? SignalType.BUY : SignalType.SELL,
      coinId,
      strength,
      price: currentPrice,
      confidence,
      reason: `${isLong ? 'Long' : 'Short'} entry: ${flipDesc} (${currentPrice.toFixed(2)}) ${action} trailing stop (${currentState.stopLevel.toFixed(2)}). ATR: ${currentATR.toFixed(4)}`,
      metadata: {
        symbol: coinSymbol,
        currentPrice,
        stopLevel: currentState.stopLevel,
        atr: currentATR,
        atrMultiplier: config.atrMultiplier,
        direction,
        signalSource: 'trend_flip'
      }
    };
  }

  private calculateEntryStrength(currentPrice: number, stopLevel: number, atr: number): number {
    if (atr === 0) return 0.5;
    const buffer = Math.abs(currentPrice - stopLevel);
    const bufferRatio = buffer / atr;
    return Math.min(1, Math.max(0.3, bufferRatio * 0.5));
  }

  /**
   * Calculate ATR stability over a lookback period.
   * More stable ATR = more reliable signals.
   */
  private calculateAtrStability(atr: number[], currentIndex: number): { stability: number; valid: boolean } {
    const lookback = 5;
    const startIndex = Math.max(0, currentIndex - lookback);

    let atrSum = 0;
    let count = 0;
    for (let i = startIndex; i <= currentIndex; i++) {
      if (Number.isFinite(atr[i])) {
        atrSum += atr[i];
        count++;
      }
    }
    const avgATR = count > 0 ? atrSum / count : atr[currentIndex];

    if (!avgATR || avgATR === 0) return { stability: 0, valid: false };

    let atrVariation = 0;
    for (let i = startIndex; i <= currentIndex; i++) {
      if (Number.isFinite(atr[i])) {
        atrVariation += Math.abs(atr[i] - avgATR) / avgATR;
      }
    }

    return {
      stability: 1 - Math.min(1, count > 0 ? atrVariation / count : 0),
      valid: true
    };
  }

  private calculateEntryConfidence(atr: number[], currentIndex: number): number {
    const { stability, valid } = this.calculateAtrStability(atr, currentIndex);
    if (!valid) return 0.45;
    return Math.min(1, 0.45 + stability * 0.35);
  }

  private calculateSignalStrength(currentPrice: number, stopLevel: number, atr: number): number {
    if (atr === 0) return 0.5;
    const breachAmount = Math.abs(currentPrice - stopLevel);
    const breachRatio = breachAmount / atr;
    return Math.min(1, Math.max(0.4, breachRatio));
  }

  private calculateConfidence(
    _prices: CandleData[],
    atr: number[],
    stopState: TrailingStopState,
    direction: Direction
  ): number {
    // ATR array is chronologically ordered, so the last element is the most recent value.
    const currentIndex = atr.length - 1;
    const { stability, valid } = this.calculateAtrStability(atr, currentIndex);
    if (!valid) return 0.5;

    let stopProgression = 0;
    if (stopState.stopLevel > stopState.previousStopLevel && direction === 'long') {
      stopProgression = 0.2;
    } else if (stopState.stopLevel < stopState.previousStopLevel && direction === 'short') {
      stopProgression = 0.2;
    }

    return Math.min(1, 0.5 + stability * 0.3 + stopProgression);
  }

  private prepareChartData(prices: CandleData[], atr: number[], config: ATRTrailingStopConfig): ChartDataPoint[] {
    return prices.map((price, index) => {
      let longStop: number | undefined;
      let shortStop: number | undefined;

      if (Number.isFinite(atr[index])) {
        const lookbackStart = Math.max(0, index - config.atrPeriod);
        const highestHigh = this.findExtremum(prices, config, 'long', lookbackStart, index);
        longStop = highestHigh - atr[index] * config.atrMultiplier;

        const lowestLow = this.findExtremum(prices, config, 'short', lookbackStart, index);
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

  getMinDataPoints(config: Record<string, unknown>): number {
    const atrPeriod = (config.atrPeriod as number) ?? 20;
    return atrPeriod + 5;
  }

  getIndicatorRequirements(_config: Record<string, unknown>): IndicatorRequirement[] {
    return [{ type: 'ATR', paramKeys: ['atrPeriod'], defaultParams: { atrPeriod: 20 } }];
  }

  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      atrPeriod: { type: 'number', default: 20, min: 14, max: 25, description: 'ATR calculation period' },
      atrMultiplier: {
        type: 'number',
        default: 4.5,
        min: 3.5,
        max: 6,
        description: 'ATR multiplier for stop distance'
      },
      tradeDirection: {
        type: 'string',
        enum: ['long', 'short', 'both'],
        default: 'long',
        description: 'Which direction to generate stops for'
      },
      useHighLow: { type: 'boolean', default: true, description: 'Use high/low vs close for calculations' },
      minConfidence: { type: 'number', default: 0.4, min: 0, max: 1, description: 'Minimum confidence required' },
      stopCooldownBars: {
        type: 'number',
        default: 3,
        min: 0,
        max: 10,
        description: 'Bars to suppress entry signals after a stop loss fires (prevents rapid re-entry churn)'
      }
    };
  }

  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) return false;
    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
