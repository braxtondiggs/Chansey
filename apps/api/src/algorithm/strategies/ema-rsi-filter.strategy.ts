import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface EMARSIFilterConfig {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  rsiPeriod: number;
  rsiMaxForBuy: number;
  rsiMinForSell: number;
  minConfidence: number;
}

/**
 * EMA + RSI Filter Strategy
 *
 * EMA crossover strategy filtered by RSI to avoid entries at overbought/oversold extremes.
 * Improves signal quality by not buying when already overbought and not selling when oversold.
 *
 * Buy signal: Fast EMA crosses above Slow EMA AND RSI < rsiMaxForBuy
 * Sell signal: Fast EMA crosses below Slow EMA AND RSI > rsiMinForSell
 *
 * Uses centralized IndicatorService for EMA and RSI calculations with caching.
 */
@Injectable()
export class EMARSIFilterStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'ema-rsi-filter-001';

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
   * Execute the EMA + RSI Filter strategy
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

        // Calculate EMAs and RSI using IndicatorService (with caching)
        const [fastEMAResult, slowEMAResult, rsiResult] = await Promise.all([
          this.indicatorService.calculateEMA(
            { coinId: coin.id, prices: priceHistory, period: config.fastEmaPeriod },
            this
          ),
          this.indicatorService.calculateEMA(
            { coinId: coin.id, prices: priceHistory, period: config.slowEmaPeriod },
            this
          ),
          this.indicatorService.calculateRSI({ coinId: coin.id, prices: priceHistory, period: config.rsiPeriod }, this)
        ]);

        const fastEMA = fastEMAResult.values;
        const slowEMA = slowEMAResult.values;
        const rsi = rsiResult.values;

        // Generate signal based on EMA crossover filtered by RSI
        const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, fastEMA, slowEMA, rsi, config);

        if (signal && signal.confidence >= config.minConfidence) {
          signals.push(signal);
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, fastEMA, slowEMA, rsi);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`EMA RSI Filter strategy execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): EMARSIFilterConfig {
    return {
      fastEmaPeriod: (config.fastEmaPeriod as number) ?? 12,
      slowEmaPeriod: (config.slowEmaPeriod as number) ?? 26,
      rsiPeriod: (config.rsiPeriod as number) ?? 14,
      rsiMaxForBuy: (config.rsiMaxForBuy as number) ?? 70,
      rsiMinForSell: (config.rsiMinForSell as number) ?? 30,
      minConfidence: (config.minConfidence as number) ?? 0.6
    };
  }

  /**
   * Check if we have enough data for both EMA and RSI calculations
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: EMARSIFilterConfig): boolean {
    const minRequired = Math.max(config.slowEmaPeriod, config.rsiPeriod) + 5;
    return !!priceHistory && priceHistory.length >= minRequired;
  }

  /**
   * Generate trading signal based on EMA crossover filtered by RSI
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    fastEMA: number[],
    slowEMA: number[],
    rsi: number[],
    config: EMARSIFilterConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (
      previousIndex < 0 ||
      isNaN(fastEMA[currentIndex]) ||
      isNaN(slowEMA[currentIndex]) ||
      isNaN(fastEMA[previousIndex]) ||
      isNaN(slowEMA[previousIndex]) ||
      isNaN(rsi[currentIndex])
    ) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const currentFastEMA = fastEMA[currentIndex];
    const currentSlowEMA = slowEMA[currentIndex];
    const previousFastEMA = fastEMA[previousIndex];
    const previousSlowEMA = slowEMA[previousIndex];
    const currentRSI = rsi[currentIndex];

    // Check for EMA crossovers
    const isBullishCrossover = previousFastEMA <= previousSlowEMA && currentFastEMA > currentSlowEMA;
    const isBearishCrossover = previousFastEMA >= previousSlowEMA && currentFastEMA < currentSlowEMA;

    // Apply RSI filters
    const rsiAllowsBuy = currentRSI < config.rsiMaxForBuy;
    const rsiAllowsSell = currentRSI > config.rsiMinForSell;

    if (isBullishCrossover) {
      if (rsiAllowsBuy) {
        // Valid buy signal: EMA crossover confirmed by RSI filter
        const strength = this.calculateSignalStrength(fastEMA, slowEMA, rsi, config, 'bullish', currentIndex);
        const confidence = this.calculateConfidence(prices, fastEMA, slowEMA, rsi, config, 'bullish', currentIndex);

        return {
          type: SignalType.BUY,
          coinId,
          strength,
          price: currentPrice,
          confidence,
          reason: `EMA bullish crossover confirmed by RSI filter: Fast EMA crossed above Slow EMA, RSI (${currentRSI.toFixed(2)}) < ${config.rsiMaxForBuy} (not overbought)`,
          metadata: {
            symbol: coinSymbol,
            fastEMA: currentFastEMA,
            slowEMA: currentSlowEMA,
            rsi: currentRSI,
            rsiFilter: 'passed',
            rsiThreshold: config.rsiMaxForBuy,
            crossoverType: 'bullish'
          }
        };
      } else {
        // Log filtered signal for debugging
        this.logger.debug(
          `Buy signal filtered: RSI (${currentRSI.toFixed(2)}) >= ${config.rsiMaxForBuy} for ${coinSymbol}`
        );
      }
    }

    if (isBearishCrossover) {
      if (rsiAllowsSell) {
        // Valid sell signal: EMA crossover confirmed by RSI filter
        const strength = this.calculateSignalStrength(fastEMA, slowEMA, rsi, config, 'bearish', currentIndex);
        const confidence = this.calculateConfidence(prices, fastEMA, slowEMA, rsi, config, 'bearish', currentIndex);

        return {
          type: SignalType.SELL,
          coinId,
          strength,
          price: currentPrice,
          confidence,
          reason: `EMA bearish crossover confirmed by RSI filter: Fast EMA crossed below Slow EMA, RSI (${currentRSI.toFixed(2)}) > ${config.rsiMinForSell} (not oversold)`,
          metadata: {
            symbol: coinSymbol,
            fastEMA: currentFastEMA,
            slowEMA: currentSlowEMA,
            rsi: currentRSI,
            rsiFilter: 'passed',
            rsiThreshold: config.rsiMinForSell,
            crossoverType: 'bearish'
          }
        };
      } else {
        // Log filtered signal for debugging
        this.logger.debug(
          `Sell signal filtered: RSI (${currentRSI.toFixed(2)}) <= ${config.rsiMinForSell} for ${coinSymbol}`
        );
      }
    }

    return null;
  }

  /**
   * Calculate signal strength based on EMA spread and RSI position
   */
  private calculateSignalStrength(
    fastEMA: number[],
    slowEMA: number[],
    rsi: number[],
    config: EMARSIFilterConfig,
    direction: 'bullish' | 'bearish',
    currentIndex: number
  ): number {
    const currentFastEMA = fastEMA[currentIndex];
    const currentSlowEMA = slowEMA[currentIndex];
    const currentRSI = rsi[currentIndex];

    // EMA divergence rate strength (how fast EMAs are separating)
    const previousIndex = currentIndex - 1;
    const previousSpread = fastEMA[previousIndex] - slowEMA[previousIndex];
    const currentSpread = currentFastEMA - currentSlowEMA;
    const spreadChange = Math.abs(currentSpread - previousSpread);
    const emaStrength = Math.min(1, (spreadChange / currentSlowEMA) * 100);

    // RSI strength based on how far from filter threshold
    let rsiStrength = 0;
    if (direction === 'bullish') {
      // Lower RSI = better for buying
      rsiStrength = (config.rsiMaxForBuy - currentRSI) / config.rsiMaxForBuy;
    } else {
      // Higher RSI = better for selling
      rsiStrength = (currentRSI - config.rsiMinForSell) / (100 - config.rsiMinForSell);
    }

    return Math.min(1, Math.max(0.4, (emaStrength + rsiStrength) / 2));
  }

  /**
   * Calculate confidence based on trend consistency and RSI position
   */
  private calculateConfidence(
    prices: PriceSummary[],
    fastEMA: number[],
    slowEMA: number[],
    rsi: number[],
    config: EMARSIFilterConfig,
    direction: 'bullish' | 'bearish',
    currentIndex: number
  ): number {
    const lookback = 5;
    const startIndex = Math.max(0, currentIndex - lookback);

    // Check price momentum confirmation
    let momentumCount = 0;
    let validBars = 0;
    for (let i = startIndex + 1; i <= currentIndex; i++) {
      validBars++;
      if (direction === 'bullish' && prices[i].avg > prices[i - 1].avg) {
        momentumCount++;
      } else if (direction === 'bearish' && prices[i].avg < prices[i - 1].avg) {
        momentumCount++;
      }
    }
    const trendScore = validBars > 0 ? momentumCount / validBars : 0;

    // RSI positioning score
    const currentRSI = rsi[currentIndex];
    let rsiScore = 0;
    if (direction === 'bullish') {
      // Ideal RSI zone for buying: 30-50
      if (currentRSI >= 30 && currentRSI <= 50) {
        rsiScore = 1;
      } else if (currentRSI < 30) {
        rsiScore = 0.8; // Oversold - good but may bounce first
      } else {
        const buyDivisor = config.rsiMaxForBuy - 50;
        rsiScore = buyDivisor === 0 ? 0 : Math.max(0, 1 - (currentRSI - 50) / buyDivisor);
      }
    } else {
      // Ideal RSI zone for selling: 50-70
      if (currentRSI >= 50 && currentRSI <= 70) {
        rsiScore = 1;
      } else if (currentRSI > 70) {
        rsiScore = 0.8; // Overbought - good but may have more to fall
      } else {
        const sellDivisor = 50 - config.rsiMinForSell;
        rsiScore = sellDivisor === 0 ? 0 : Math.max(0, 1 - (50 - currentRSI) / sellDivisor);
      }
    }

    // Base confidence for filtered signals
    const baseConfidence = 0.55;

    return Math.min(1, baseConfidence + trendScore * 0.2 + rsiScore * 0.25);
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(
    prices: PriceSummary[],
    fastEMA: number[],
    slowEMA: number[],
    rsi: number[]
  ): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        fastEMA: fastEMA[index],
        slowEMA: slowEMA[index],
        rsi: rsi[index],
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
      fastEmaPeriod: { type: 'number', default: 12, min: 5, max: 25, description: 'Fast EMA period' },
      slowEmaPeriod: { type: 'number', default: 26, min: 15, max: 50, description: 'Slow EMA period' },
      rsiPeriod: { type: 'number', default: 14, min: 5, max: 30, description: 'RSI calculation period' },
      rsiMaxForBuy: {
        type: 'number',
        default: 70,
        min: 50,
        max: 80,
        description: 'Max RSI to allow buy signals (avoid buying overbought)'
      },
      rsiMinForSell: {
        type: 'number',
        default: 30,
        min: 20,
        max: 50,
        description: 'Min RSI to allow sell signals (avoid selling oversold)'
      },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1, description: 'Minimum confidence required' }
    };
  }

  /**
   * Enhanced validation for EMA RSI Filter strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
