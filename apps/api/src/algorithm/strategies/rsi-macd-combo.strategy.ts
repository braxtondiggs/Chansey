import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

interface RSIMACDComboConfig {
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  confirmationWindow: number;
  minConfidence: number;
}

interface SignalState {
  rsiSignal: 'buy' | 'sell' | null;
  rsiBar: number;
  macdSignal: 'buy' | 'sell' | null;
  macdBar: number;
}

/**
 * RSI + MACD Combo Strategy
 *
 * Multi-indicator confirmation strategy requiring both RSI and MACD signals to align.
 * Higher confidence signals through dual confirmation within a configurable window.
 *
 * Buy signal: RSI oversold AND MACD bullish crossover (within confirmation window)
 * Sell signal: RSI overbought AND MACD bearish crossover (within confirmation window)
 *
 * Uses centralized IndicatorService for both RSI and MACD calculations with caching.
 */
@Injectable()
export class RSIMACDComboStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'rsi-macd-combo-001';

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
   * Execute the RSI + MACD Combo strategy
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
          { coinId: coin.id, prices: priceHistory, period: config.rsiPeriod },
          this
        );

        // Calculate MACD using IndicatorService (with caching)
        const macdResult = await this.indicatorService.calculateMACD(
          {
            coinId: coin.id,
            prices: priceHistory,
            fastPeriod: config.macdFast,
            slowPeriod: config.macdSlow,
            signalPeriod: config.macdSignal
          },
          this
        );

        const rsi = rsiResult.values;
        const { macd, signal: macdSignalLine, histogram } = macdResult;

        // Generate signal based on combined indicators
        const tradingSignal = this.generateSignal(
          coin.id,
          coin.symbol,
          priceHistory,
          rsi,
          macd,
          macdSignalLine,
          histogram,
          config
        );

        if (tradingSignal && tradingSignal.confidence >= config.minConfidence) {
          signals.push(tradingSignal);
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, rsi, macd, macdSignalLine, histogram);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`RSI MACD Combo strategy execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): RSIMACDComboConfig {
    return {
      rsiPeriod: (config.rsiPeriod as number) ?? 14,
      rsiOversold: (config.rsiOversold as number) ?? 35,
      rsiOverbought: (config.rsiOverbought as number) ?? 65,
      macdFast: (config.macdFast as number) ?? 12,
      macdSlow: (config.macdSlow as number) ?? 26,
      macdSignal: (config.macdSignal as number) ?? 9,
      confirmationWindow: (config.confirmationWindow as number) ?? 3,
      minConfidence: (config.minConfidence as number) ?? 0.7
    };
  }

  /**
   * Check if we have enough data for both RSI and MACD calculations
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: RSIMACDComboConfig): boolean {
    const macdMinRequired = config.macdSlow + config.macdSignal - 1;
    const minRequired = Math.max(config.rsiPeriod, macdMinRequired) + config.confirmationWindow;
    return !!priceHistory && priceHistory.length >= minRequired;
  }

  /**
   * Generate trading signal based on combined RSI and MACD signals
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    rsi: number[],
    macd: number[],
    macdSignalLine: number[],
    histogram: number[],
    config: RSIMACDComboConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const windowStart = Math.max(0, currentIndex - config.confirmationWindow + 1);

    // Scan for RSI and MACD signals within the confirmation window
    const signalState: SignalState = {
      rsiSignal: null,
      rsiBar: -1,
      macdSignal: null,
      macdBar: -1
    };

    for (let i = windowStart; i <= currentIndex; i++) {
      // Check RSI signals
      if (!isNaN(rsi[i])) {
        if (rsi[i] < config.rsiOversold) {
          signalState.rsiSignal = 'buy';
          signalState.rsiBar = i;
        } else if (rsi[i] > config.rsiOverbought) {
          signalState.rsiSignal = 'sell';
          signalState.rsiBar = i;
        }
      }

      // Check MACD crossover signals
      if (
        i > 0 &&
        !isNaN(macd[i]) &&
        !isNaN(macdSignalLine[i]) &&
        !isNaN(macd[i - 1]) &&
        !isNaN(macdSignalLine[i - 1])
      ) {
        const isBullishCrossover = macd[i - 1] <= macdSignalLine[i - 1] && macd[i] > macdSignalLine[i];
        const isBearishCrossover = macd[i - 1] >= macdSignalLine[i - 1] && macd[i] < macdSignalLine[i];

        if (isBullishCrossover) {
          signalState.macdSignal = 'buy';
          signalState.macdBar = i;
        } else if (isBearishCrossover) {
          signalState.macdSignal = 'sell';
          signalState.macdBar = i;
        }
      }
    }

    const currentPrice = prices[currentIndex].avg;
    const currentRSI = rsi[currentIndex];
    const currentMACD = macd[currentIndex];
    const currentMACDSignal = macdSignalLine[currentIndex];
    const currentHistogram = histogram[currentIndex];

    // Generate BUY signal if both RSI and MACD agree within window
    if (signalState.rsiSignal === 'buy' && signalState.macdSignal === 'buy') {
      const strength = this.calculateSignalStrength(
        rsi,
        macd,
        macdSignalLine,
        histogram,
        config,
        'bullish',
        currentIndex,
        signalState
      );
      const confidence = this.calculateConfidence(signalState, config, currentIndex);

      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `RSI+MACD Combo BUY: RSI oversold (${rsi[signalState.rsiBar].toFixed(2)} < ${config.rsiOversold}) + MACD bullish crossover within ${config.confirmationWindow} bars`,
        metadata: {
          symbol: coinSymbol,
          rsi: currentRSI,
          macd: currentMACD,
          macdSignal: currentMACDSignal,
          histogram: currentHistogram,
          rsiSignalBar: signalState.rsiBar,
          macdSignalBar: signalState.macdBar,
          confirmationWindow: config.confirmationWindow,
          comboType: 'bullish'
        }
      };
    }

    // Generate SELL signal if both RSI and MACD agree within window
    if (signalState.rsiSignal === 'sell' && signalState.macdSignal === 'sell') {
      const strength = this.calculateSignalStrength(
        rsi,
        macd,
        macdSignalLine,
        histogram,
        config,
        'bearish',
        currentIndex,
        signalState
      );
      const confidence = this.calculateConfidence(signalState, config, currentIndex);

      return {
        type: SignalType.SELL,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `RSI+MACD Combo SELL: RSI overbought (${rsi[signalState.rsiBar].toFixed(2)} > ${config.rsiOverbought}) + MACD bearish crossover within ${config.confirmationWindow} bars`,
        metadata: {
          symbol: coinSymbol,
          rsi: currentRSI,
          macd: currentMACD,
          macdSignal: currentMACDSignal,
          histogram: currentHistogram,
          rsiSignalBar: signalState.rsiBar,
          macdSignalBar: signalState.macdBar,
          confirmationWindow: config.confirmationWindow,
          comboType: 'bearish'
        }
      };
    }

    return null;
  }

  /**
   * Calculate signal strength based on both indicators
   */
  private calculateSignalStrength(
    rsi: number[],
    macd: number[],
    macdSignalLine: number[],
    histogram: number[],
    config: RSIMACDComboConfig,
    direction: 'bullish' | 'bearish',
    currentIndex: number,
    signalState: SignalState
  ): number {
    const signalRSI = rsi[signalState.rsiBar];
    const signalHistogram = histogram[signalState.macdBar];

    // RSI strength: how far into oversold/overbought territory (at signal bar)
    let rsiStrength = 0;
    if (direction === 'bullish' && signalRSI < config.rsiOversold) {
      rsiStrength = (config.rsiOversold - signalRSI) / config.rsiOversold;
    } else if (direction === 'bearish' && signalRSI > config.rsiOverbought) {
      rsiStrength = (signalRSI - config.rsiOverbought) / (100 - config.rsiOverbought);
    }

    // MACD strength: histogram magnitude (at signal bar)
    let macdStrength = 0;
    let avgHistogram = 0;
    let count = 0;
    for (let i = Math.max(0, currentIndex - 20); i <= currentIndex; i++) {
      if (!isNaN(histogram[i])) {
        avgHistogram += Math.abs(histogram[i]);
        count++;
      }
    }
    avgHistogram = count > 0 ? avgHistogram / count : Math.abs(signalHistogram);
    macdStrength = Math.min(1, Math.abs(signalHistogram) / (avgHistogram * 2));

    // Combined strength (average of both)
    return Math.min(1, (rsiStrength + macdStrength) / 2 + 0.3);
  }

  /**
   * Calculate confidence based on signal alignment timing
   */
  private calculateConfidence(signalState: SignalState, config: RSIMACDComboConfig, currentIndex: number): number {
    // Higher confidence when both signals occurred recently and close together
    const rsiAge = currentIndex - signalState.rsiBar;
    const macdAge = currentIndex - signalState.macdBar;
    const signalGap = Math.abs(signalState.rsiBar - signalState.macdBar);

    // Fresher signals = higher confidence
    const freshnessScore = 1 - (rsiAge + macdAge) / (config.confirmationWindow * 2);

    // Signals occurring closer together = higher confidence
    const alignmentScore = 1 - signalGap / config.confirmationWindow;

    // Combo strategies inherently have higher confidence due to dual confirmation
    const baseConfidence = 0.6;

    return Math.min(1, baseConfidence + freshnessScore * 0.2 + alignmentScore * 0.2);
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(
    prices: PriceSummary[],
    rsi: number[],
    macd: number[],
    macdSignalLine: number[],
    histogram: number[]
  ): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        rsi: rsi[index],
        macd: macd[index],
        macdSignal: macdSignalLine[index],
        histogram: histogram[index],
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
      rsiPeriod: { type: 'number', default: 14, min: 5, max: 30, description: 'RSI calculation period' },
      rsiOversold: {
        type: 'number',
        default: 35,
        min: 20,
        max: 45,
        description: 'RSI oversold threshold (relaxed for combo)'
      },
      rsiOverbought: {
        type: 'number',
        default: 65,
        min: 55,
        max: 80,
        description: 'RSI overbought threshold (relaxed for combo)'
      },
      macdFast: { type: 'number', default: 12, min: 5, max: 20, description: 'MACD fast EMA period' },
      macdSlow: { type: 'number', default: 26, min: 15, max: 50, description: 'MACD slow EMA period' },
      macdSignal: { type: 'number', default: 9, min: 5, max: 15, description: 'MACD signal line period' },
      confirmationWindow: {
        type: 'number',
        default: 3,
        min: 1,
        max: 10,
        description: 'Bars within which both signals must occur'
      },
      minConfidence: { type: 'number', default: 0.7, min: 0, max: 1, description: 'Minimum confidence required' }
    };
  }

  getParameterConstraints(): ParameterConstraint[] {
    return [
      {
        type: 'less_than',
        param1: 'macdFast',
        param2: 'macdSlow',
        message: 'macdFast must be less than macdSlow'
      }
    ];
  }

  /**
   * Enhanced validation for RSI MACD Combo strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
