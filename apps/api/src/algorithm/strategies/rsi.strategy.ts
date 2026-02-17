import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface RSIConfig {
  period: number;
  oversoldThreshold: number;
  overboughtThreshold: number;
  minConfidence: number;
}

/**
 * RSI (Relative Strength Index) Momentum Strategy
 *
 * Generates buy signals when RSI indicates oversold conditions (RSI < 30)
 * and sell signals when overbought (RSI > 70). Classic momentum-based strategy.
 *
 * Uses centralized IndicatorService for RSI calculations with caching.
 */
@Injectable()
export class RSIStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'rsi-momentum-001';

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
   * Execute the RSI strategy
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

        // Calculate RSI using IndicatorService (with caching)
        const rsiResult = await this.indicatorService.calculateRSI(
          { coinId: coin.id, prices: priceHistory, period: config.period },
          this
        );

        const rsi = rsiResult.values;

        // Generate signal based on RSI levels
        const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, rsi, config);

        if (signal && signal.confidence >= config.minConfidence) {
          signals.push(signal);
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, rsi);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`RSI strategy execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): RSIConfig {
    return {
      period: (config.period as number) ?? 14,
      oversoldThreshold: (config.oversoldThreshold as number) ?? 30,
      overboughtThreshold: (config.overboughtThreshold as number) ?? 70,
      minConfidence: (config.minConfidence as number) ?? 0.6
    };
  }

  /**
   * Check if we have enough data for RSI calculation
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: RSIConfig): boolean {
    return !!priceHistory && priceHistory.length >= config.period + 1;
  }

  /**
   * Generate trading signal based on RSI levels
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    rsi: number[],
    config: RSIConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (previousIndex < 0 || isNaN(rsi[currentIndex]) || isNaN(rsi[previousIndex])) {
      return null;
    }

    const currentRSI = rsi[currentIndex];
    const previousRSI = rsi[previousIndex];
    const currentPrice = prices[currentIndex].avg;

    // Check for oversold condition (BUY signal)
    if (currentRSI < config.oversoldThreshold) {
      const strength = this.calculateSignalStrength(currentRSI, config.oversoldThreshold, 'oversold');
      const confidence = this.calculateConfidence(rsi, config, 'oversold');

      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `RSI oversold: ${currentRSI.toFixed(2)} < ${config.oversoldThreshold} (prev: ${previousRSI.toFixed(2)})`,
        metadata: {
          symbol: coinSymbol,
          rsi: currentRSI,
          previousRSI,
          threshold: config.oversoldThreshold,
          condition: 'oversold'
        }
      };
    }

    // Check for overbought condition (SELL signal)
    if (currentRSI > config.overboughtThreshold) {
      const strength = this.calculateSignalStrength(currentRSI, config.overboughtThreshold, 'overbought');
      const confidence = this.calculateConfidence(rsi, config, 'overbought');

      return {
        type: SignalType.SELL,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `RSI overbought: ${currentRSI.toFixed(2)} > ${config.overboughtThreshold} (prev: ${previousRSI.toFixed(2)})`,
        metadata: {
          symbol: coinSymbol,
          rsi: currentRSI,
          previousRSI,
          threshold: config.overboughtThreshold,
          condition: 'overbought'
        }
      };
    }

    return null;
  }

  /**
   * Calculate signal strength based on RSI distance from threshold
   */
  private calculateSignalStrength(rsi: number, threshold: number, condition: 'oversold' | 'overbought'): number {
    if (condition === 'oversold') {
      // RSI of 10 with threshold 30 = stronger signal than RSI of 28
      const distance = threshold - rsi;
      return Math.min(1, Math.max(0, distance / threshold));
    } else {
      // RSI of 90 with threshold 70 = stronger signal than RSI of 72
      const distance = rsi - threshold;
      const maxDistance = 100 - threshold;
      return Math.min(1, Math.max(0, distance / maxDistance));
    }
  }

  /**
   * Calculate confidence based on RSI trend consistency
   */
  private calculateConfidence(rsi: number[], config: RSIConfig, condition: 'oversold' | 'overbought'): number {
    const recentPeriod = 5;
    const startIndex = Math.max(0, rsi.length - recentPeriod);

    let consistentBars = 0;
    for (let i = startIndex; i < rsi.length; i++) {
      if (isNaN(rsi[i])) continue;

      if (condition === 'oversold' && rsi[i] < 50) {
        consistentBars++;
      } else if (condition === 'overbought' && rsi[i] > 50) {
        consistentBars++;
      }
    }

    // Higher confidence if RSI has been trending in the same direction
    const consistency = consistentBars / recentPeriod;
    return Math.min(1, 0.1 + consistency * 0.9);
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(prices: PriceSummary[], rsi: number[]): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
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
      period: { type: 'number', default: 14, min: 5, max: 50, description: 'RSI calculation period' },
      oversoldThreshold: {
        type: 'number',
        default: 30,
        min: 10,
        max: 40,
        description: 'RSI level below which asset is oversold'
      },
      overboughtThreshold: {
        type: 'number',
        default: 70,
        min: 60,
        max: 90,
        description: 'RSI level above which asset is overbought'
      },
      minConfidence: {
        type: 'number',
        default: 0.6,
        min: 0,
        max: 1,
        description: 'Minimum confidence required to generate signal'
      }
    };
  }

  /**
   * Enhanced validation for RSI strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
