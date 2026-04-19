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

interface RSIDivergenceConfig {
  rsiPeriod: number;
  emaPeriod: number;
  lookbackPeriod: number;
  pivotStrength: number;
  pivotTolerance: number;
  minDivergencePercent: number;
  rsiOversold: number;
  rsiOverbought: number;
  minConfidence: number;
  stopLossMin: number;
  stopLossMax: number;
  takeProfitMin: number;
  takeProfitMax: number;
}

interface PivotPoint {
  index: number;
  price: number;
  rsi: number;
  type: 'high' | 'low';
}

interface DivergenceResult {
  type: 'bullish' | 'bearish';
  pivot1: PivotPoint;
  pivot2: PivotPoint;
  priceDivergence: number;
  rsiDivergence: number;
  score: number;
}

const MIN_RSI_DIVERGENCE = 2;

/**
 * RSI Divergence Strategy
 *
 * Detects divergence between price action and RSI indicator.
 * Bullish divergence: Price makes lower lows while RSI makes higher lows (potential reversal up)
 * Bearish divergence: Price makes higher highs while RSI makes lower highs (potential reversal down)
 *
 * Uses ATR-tolerant pivot detection, EMA trend filter, RSI zone gating,
 * and ATR-scaled exit configuration for robust reversal trading.
 */
@Injectable()
export class RSIDivergenceStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'rsi-divergence-001';

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
      const skipCache = this.shouldSkipIndicatorCache(context);

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, config)) {
          this.logger.debug(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        const rsi =
          this.getPrecomputedSlice(context, coin.id, `rsi_${config.rsiPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateRSI(
              { coinId: coin.id, prices: priceHistory, period: config.rsiPeriod, skipCache },
              this
            )
          ).values;

        const ema =
          this.getPrecomputedSlice(context, coin.id, `ema_${config.emaPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateEMA(
              { coinId: coin.id, prices: priceHistory, period: config.emaPeriod, skipCache },
              this
            )
          ).values;

        const atr =
          this.getPrecomputedSlice(context, coin.id, 'atr_14', priceHistory.length) ??
          (
            await this.indicatorService.calculateATR(
              { coinId: coin.id, prices: priceHistory, period: 14, skipCache },
              this
            )
          ).values;

        const divergence = this.detectDivergence(priceHistory, rsi, atr, config);

        if (divergence) {
          const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, rsi, ema, atr, divergence, config);
          if (signal && signal.confidence >= config.minConfidence) {
            signals.push(signal);
          }
        }

        if (!isBacktest) {
          chartData[coin.id] = this.prepareChartData(priceHistory, rsi, ema);
        }
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`RSI Divergence strategy execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  private getConfigWithDefaults(config: Record<string, unknown>): RSIDivergenceConfig {
    return {
      rsiPeriod: (config.rsiPeriod as number) ?? 14,
      emaPeriod: (config.emaPeriod as number) ?? 50,
      lookbackPeriod: (config.lookbackPeriod as number) ?? 30,
      pivotStrength: (config.pivotStrength as number) ?? 3,
      pivotTolerance: (config.pivotTolerance as number) ?? 0.3,
      minDivergencePercent: (config.minDivergencePercent as number) ?? 2,
      rsiOversold: (config.rsiOversold as number) ?? 40,
      rsiOverbought: (config.rsiOverbought as number) ?? 60,
      minConfidence: (config.minConfidence as number) ?? 0.5,
      stopLossMin: (config.stopLossMin as number) ?? 2,
      stopLossMax: (config.stopLossMax as number) ?? 15,
      takeProfitMin: (config.takeProfitMin as number) ?? 3,
      takeProfitMax: (config.takeProfitMax as number) ?? 20
    };
  }

  private hasEnoughData(priceHistory: CandleData[] | undefined, config: RSIDivergenceConfig): boolean {
    const minRequired = Math.max(config.rsiPeriod, config.emaPeriod) + config.lookbackPeriod + config.pivotStrength * 2;
    return !!priceHistory && priceHistory.length >= minRequired;
  }

  /**
   * Find pivot highs using ATR-tolerant comparison.
   * Neighbors only need to be below (pivotHigh - ATR * tolerance), not strictly lower.
   */
  private findPivotHighs(
    prices: CandleData[],
    rsi: number[],
    atr: number[],
    tolerance: number,
    pivotStrength: number,
    startIndex: number,
    endIndex: number
  ): PivotPoint[] {
    const pivots: PivotPoint[] = [];

    for (let i = startIndex + pivotStrength; i <= endIndex - pivotStrength; i++) {
      if (!Number.isFinite(rsi[i]) || !Number.isFinite(atr[i]) || atr[i] <= 0) continue;

      const currentHigh = prices[i].high;
      const threshold = currentHigh - atr[i] * tolerance;
      let isPivot = true;

      for (let j = 1; j <= pivotStrength; j++) {
        if (prices[i - j].high > threshold || prices[i + j].high > threshold) {
          isPivot = false;
          break;
        }
      }

      if (isPivot) {
        pivots.push({ index: i, price: currentHigh, rsi: rsi[i], type: 'high' });
      }
    }

    return pivots;
  }

  /**
   * Find pivot lows using ATR-tolerant comparison.
   * Neighbors only need to be above (pivotLow + ATR * tolerance), not strictly higher.
   */
  private findPivotLows(
    prices: CandleData[],
    rsi: number[],
    atr: number[],
    tolerance: number,
    pivotStrength: number,
    startIndex: number,
    endIndex: number
  ): PivotPoint[] {
    const pivots: PivotPoint[] = [];

    for (let i = startIndex + pivotStrength; i <= endIndex - pivotStrength; i++) {
      if (!Number.isFinite(rsi[i]) || !Number.isFinite(atr[i]) || atr[i] <= 0) continue;

      const currentLow = prices[i].low;
      const threshold = currentLow + atr[i] * tolerance;
      let isPivot = true;

      for (let j = 1; j <= pivotStrength; j++) {
        if (prices[i - j].low < threshold || prices[i + j].low < threshold) {
          isPivot = false;
          break;
        }
      }

      if (isPivot) {
        pivots.push({ index: i, price: currentLow, rsi: rsi[i], type: 'low' });
      }
    }

    return pivots;
  }

  /**
   * Scan ALL pivot pairs and return the strongest divergence by combined magnitude.
   */
  private detectDivergence(
    prices: CandleData[],
    rsi: number[],
    atr: number[],
    config: RSIDivergenceConfig
  ): DivergenceResult | null {
    const currentIndex = prices.length - 1;
    const lookbackStart = Math.max(0, currentIndex - config.lookbackPeriod - config.pivotStrength);
    const lookbackEnd = currentIndex;

    const pivotHighs = this.findPivotHighs(
      prices,
      rsi,
      atr,
      config.pivotTolerance,
      config.pivotStrength,
      lookbackStart,
      lookbackEnd
    );
    const pivotLows = this.findPivotLows(
      prices,
      rsi,
      atr,
      config.pivotTolerance,
      config.pivotStrength,
      lookbackStart,
      lookbackEnd
    );

    let best: DivergenceResult | null = null;

    // Scan all pivot high pairs for bearish divergence
    for (let i = 0; i < pivotHighs.length; i++) {
      for (let j = i + 1; j < pivotHighs.length; j++) {
        const p1 = pivotHighs[i];
        const p2 = pivotHighs[j];
        const priceDivergence = ((p2.price - p1.price) / p1.price) * 100;
        const rsiDivergence = p2.rsi - p1.rsi;

        if (priceDivergence >= config.minDivergencePercent && rsiDivergence <= -MIN_RSI_DIVERGENCE) {
          const score = Math.abs(priceDivergence) + Math.abs(rsiDivergence);
          if (!best || score > best.score) {
            best = { type: 'bearish', pivot1: p1, pivot2: p2, priceDivergence, rsiDivergence, score };
          }
        }
      }
    }

    // Scan all pivot low pairs for bullish divergence
    for (let i = 0; i < pivotLows.length; i++) {
      for (let j = i + 1; j < pivotLows.length; j++) {
        const p1 = pivotLows[i];
        const p2 = pivotLows[j];
        const priceDivergence = ((p2.price - p1.price) / p1.price) * 100;
        const rsiDivergence = p2.rsi - p1.rsi;

        if (priceDivergence <= -config.minDivergencePercent && rsiDivergence >= MIN_RSI_DIVERGENCE) {
          const score = Math.abs(priceDivergence) + Math.abs(rsiDivergence);
          if (!best || score > best.score) {
            best = { type: 'bullish', pivot1: p1, pivot2: p2, priceDivergence, rsiDivergence, score };
          }
        }
      }
    }

    return best;
  }

  /**
   * Generate trading signal with EMA trend filter and RSI zone gating.
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: CandleData[],
    rsi: number[],
    ema: number[],
    atr: number[],
    divergence: DivergenceResult,
    config: RSIDivergenceConfig
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const currentPrice = prices[currentIndex].avg;
    const currentRSI = rsi[currentIndex];
    const currentEMA = ema[currentIndex];
    const currentATR = atr[currentIndex];

    if (!Number.isFinite(currentRSI) || !Number.isFinite(currentEMA) || !Number.isFinite(currentATR)) {
      return null;
    }

    // RSI zone gate + EMA trend filter
    if (divergence.type === 'bullish') {
      if (currentRSI >= config.rsiOversold) return null;
      if (currentPrice > currentEMA * 1.02) return null; // price far above EMA
    } else {
      if (currentRSI <= config.rsiOverbought) return null;
      if (currentPrice < currentEMA * 0.98) return null; // price far below EMA
    }

    const strength = this.calculateSignalStrength(divergence, config);
    const confidence = this.calculateConfidence(prices, rsi, divergence, currentATR, config);
    const exitConfig = this.buildExitConfig(
      currentATR,
      currentPrice,
      divergence,
      config.stopLossMin,
      config.stopLossMax,
      config.takeProfitMin,
      config.takeProfitMax
    );

    const metadata = {
      symbol: coinSymbol,
      divergenceType: divergence.type,
      currentRSI,
      currentEMA,
      currentATR,
      pivot1Index: divergence.pivot1.index,
      pivot1Price: divergence.pivot1.price,
      pivot1RSI: divergence.pivot1.rsi,
      pivot2Index: divergence.pivot2.index,
      pivot2Price: divergence.pivot2.price,
      pivot2RSI: divergence.pivot2.rsi,
      priceDivergence: divergence.priceDivergence,
      rsiDivergence: divergence.rsiDivergence,
      divergenceScore: divergence.score
    };

    if (divergence.type === 'bullish') {
      return {
        type: SignalType.BUY,
        coinId,
        strength,
        price: currentPrice,
        confidence,
        reason: `Bullish RSI divergence: Price made lower low (${divergence.priceDivergence.toFixed(2)}%) while RSI made higher low (+${divergence.rsiDivergence.toFixed(2)} points). RSI=${currentRSI.toFixed(1)}, EMA=${currentEMA.toFixed(2)}`,
        metadata,
        exitConfig
      };
    }

    return {
      type: SignalType.SELL,
      coinId,
      strength,
      price: currentPrice,
      confidence,
      reason: `Bearish RSI divergence: Price made higher high (+${divergence.priceDivergence.toFixed(2)}%) while RSI made lower high (${divergence.rsiDivergence.toFixed(2)} points). RSI=${currentRSI.toFixed(1)}, EMA=${currentEMA.toFixed(2)}`,
      metadata,
      exitConfig
    };
  }

  private calculateSignalStrength(divergence: DivergenceResult, config: RSIDivergenceConfig): number {
    const priceStrength = Math.abs(divergence.priceDivergence) / (config.minDivergencePercent * 3);
    const rsiStrength = Math.abs(divergence.rsiDivergence) / 20;
    return Math.min(1, Math.max(0.4, (priceStrength + rsiStrength) / 2));
  }

  /**
   * Confidence: base 0.35 + recency (0.25) + clarity (0.25) + RSI zone depth (0.25) + volatility (0.15)
   */
  private calculateConfidence(
    prices: CandleData[],
    rsi: number[],
    divergence: DivergenceResult,
    currentATR: number,
    config: RSIDivergenceConfig
  ): number {
    const currentIndex = prices.length - 1;
    const currentRSI = rsi[currentIndex];
    const currentPrice = prices[currentIndex].avg;

    // Recency: more recent pivot2 → higher confidence
    const pivot2Age = currentIndex - divergence.pivot2.index;
    const recencyScore = 1 - Math.min(1, pivot2Age / config.lookbackPeriod);

    // Clarity: larger divergence magnitude
    const clarityScore = Math.min(1, Math.abs(divergence.priceDivergence) / (config.minDivergencePercent * 2));

    // RSI zone depth: deeper into oversold/overbought → stronger signal
    let zoneDepthScore = 0;
    if (Number.isFinite(currentRSI)) {
      if (divergence.type === 'bullish' && currentRSI < config.rsiOversold) {
        zoneDepthScore = Math.min(1, (config.rsiOversold - currentRSI) / 20);
      } else if (divergence.type === 'bearish' && currentRSI > config.rsiOverbought) {
        zoneDepthScore = Math.min(1, (currentRSI - config.rsiOverbought) / 20);
      }
    }

    // Volatility context: moderate ATR relative to price is ideal
    const atrPct = currentPrice > 0 ? (currentATR / currentPrice) * 100 : 0;
    const volScore = atrPct >= 1 && atrPct <= 5 ? 1 : atrPct > 0 ? 0.5 : 0;

    const base = 0.35;
    return Math.min(1, base + recencyScore * 0.25 + clarityScore * 0.25 + zoneDepthScore * 0.25 + volScore * 0.15);
  }

  /**
   * ATR-scaled exit configuration with optimizer-tunable bounds.
   *
   * Stop-loss: max(stopLossMin, min(stopLossMax, ATR/price * 1.5))
   * Take-profit: max(takeProfitMin, min(takeProfitMax, ATR/price * 2.5 + magBonus))
   * Trailing stop: 1x ATR percentage, activates at 1.5% profit.
   *
   * The min/max bounds come from the strategy schema so the optimizer can widen
   * or tighten the search range.
   */
  private buildExitConfig(
    currentATR: number,
    currentPrice: number,
    divergence: DivergenceResult,
    stopLossMin: number,
    stopLossMax: number,
    takeProfitMin: number,
    takeProfitMax: number
  ): Partial<ExitConfig> {
    const atrPct = currentPrice > 0 ? (currentATR / currentPrice) * 100 : 3;
    const magBonus = Math.min(2, divergence.score / 30);

    const stopLossPct = Math.max(stopLossMin, Math.min(stopLossMax, atrPct * 1.5));
    const takeProfitPct = Math.max(takeProfitMin, Math.min(takeProfitMax, atrPct * 2.5 + magBonus));
    const trailingPct = Math.max(1, Math.min(4, atrPct));

    return {
      enableStopLoss: true,
      stopLossType: StopLossType.PERCENTAGE,
      stopLossValue: stopLossPct,
      enableTakeProfit: true,
      takeProfitType: TakeProfitType.PERCENTAGE,
      takeProfitValue: takeProfitPct,
      enableTrailingStop: true,
      trailingType: TrailingType.PERCENTAGE,
      trailingValue: trailingPct,
      trailingActivation: TrailingActivationType.PERCENTAGE,
      trailingActivationValue: 1.5,
      useOco: true
    };
  }

  private prepareChartData(prices: CandleData[], rsi: number[], ema: number[]): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        rsi: rsi[index],
        ema: ema[index],
        high: price.high,
        low: price.low
      }
    }));
  }

  getMinDataPoints(config: Record<string, unknown>): number {
    const rsiPeriod = (config.rsiPeriod as number) ?? 14;
    const emaPeriod = (config.emaPeriod as number) ?? 50;
    const lookbackPeriod = (config.lookbackPeriod as number) ?? 30;
    const pivotStrength = (config.pivotStrength as number) ?? 3;
    return Math.max(rsiPeriod, emaPeriod) + lookbackPeriod + pivotStrength * 2;
  }

  getIndicatorRequirements(_config: Record<string, unknown>): IndicatorRequirement[] {
    return [
      { type: 'RSI', paramKeys: ['rsiPeriod'], defaultParams: { rsiPeriod: 14 } },
      { type: 'EMA', paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 50 } },
      { type: 'ATR', paramKeys: ['atrPeriod'], defaultParams: { atrPeriod: 14 } }
    ];
  }

  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      rsiPeriod: { type: 'number', default: 14, min: 7, max: 28, description: 'RSI calculation period' },
      emaPeriod: { type: 'number', default: 50, min: 20, max: 100, description: 'EMA trend filter period' },
      lookbackPeriod: {
        type: 'number',
        default: 30,
        min: 15,
        max: 60,
        description: 'Lookback period for finding pivots'
      },
      pivotStrength: {
        type: 'number',
        default: 3,
        min: 2,
        max: 5,
        description: 'Bars on each side required to form a pivot high/low'
      },
      pivotTolerance: {
        type: 'number',
        default: 0.3,
        min: 0.1,
        max: 0.8,
        description: 'ATR fraction for pivot detection tolerance'
      },
      minDivergencePercent: {
        type: 'number',
        default: 2,
        min: 1,
        max: 10,
        description: 'Minimum price divergence percentage'
      },
      rsiOversold: {
        type: 'number',
        default: 40,
        min: 25,
        max: 45,
        description: 'RSI oversold zone gate for bullish signals'
      },
      rsiOverbought: {
        type: 'number',
        default: 60,
        min: 55,
        max: 75,
        description: 'RSI overbought zone gate for bearish signals'
      },
      minConfidence: { type: 'number', default: 0.5, min: 0, max: 1, description: 'Minimum confidence required' },
      stopLossMin: {
        type: 'number',
        default: 2,
        min: 1,
        max: 5,
        description: 'Lower bound for ATR-scaled stop-loss percentage'
      },
      stopLossMax: {
        type: 'number',
        default: 15,
        min: 5,
        max: 15,
        description: 'Upper bound for ATR-scaled stop-loss percentage'
      },
      takeProfitMin: {
        type: 'number',
        default: 3,
        min: 2,
        max: 10,
        description: 'Lower bound for ATR-scaled take-profit percentage'
      },
      takeProfitMax: {
        type: 'number',
        default: 20,
        min: 6,
        max: 30,
        description: 'Upper bound for ATR-scaled take-profit percentage'
      }
    };
  }

  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);
    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
