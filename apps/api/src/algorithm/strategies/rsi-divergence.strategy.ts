import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { MarketRegimeType } from '@chansey/api-interfaces';

import {
  applyLowVolRelaxation,
  getRSIDivergenceConfigSchema,
  getRSIDivergenceConfigWithDefaults,
  getRSIDivergenceIndicatorRequirements,
  getRSIDivergenceMinDataPoints,
  getRSIDivergenceParameterConstraints,
  hasEnoughDataForRSIDivergence,
  type RSIDivergenceConfig
} from './rsi-divergence-config';
import { detectRSIDivergence, type DivergenceResult } from './rsi-divergence-pivot.util';

import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import {
  ExitConfig,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../../order/interfaces/exit-config.interface';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import {
  type AdxGateContext,
  applyAdxGate,
  IIndicatorProvider,
  IndicatorCalculatorMap,
  IndicatorRequirement,
  IndicatorService
} from '../indicators';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

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
      const baseConfig = getRSIDivergenceConfigWithDefaults(context.config);
      const inLowVol = baseConfig.lowVolRelaxation && context.volatilityRegime === MarketRegimeType.LOW_VOLATILITY;
      const config = inLowVol ? applyLowVolRelaxation(baseConfig) : baseConfig;
      const isBacktest = !!(
        context.metadata?.backtestId ||
        context.metadata?.isOptimization ||
        context.metadata?.isLiveReplay
      );
      const skipCache = this.shouldSkipIndicatorCache(context);

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!hasEnoughDataForRSIDivergence(priceHistory, config)) {
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

        const divergence = detectRSIDivergence(priceHistory, rsi, atr, config);

        if (divergence) {
          const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, rsi, ema, atr, divergence, config);
          if (signal && signal.confidence >= config.minConfidence) {
            const adxCtx: AdxGateContext = {
              indicatorService: this.indicatorService,
              getPrecomputedSlice: (coinId, key, length) => this.getPrecomputedSlice(context, coinId, key, length),
              provider: this,
              logger: this.logger,
              isBacktest,
              skipCache
            };
            const gated = await applyAdxGate(adxCtx, coin, priceHistory, signal, config);
            if (gated) signals.push(gated);
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
    return getRSIDivergenceMinDataPoints(config);
  }

  getIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
    return getRSIDivergenceIndicatorRequirements(config);
  }

  getConfigSchema(): Record<string, unknown> {
    return getRSIDivergenceConfigSchema(super.getConfigSchema());
  }

  override getParameterConstraints(): ParameterConstraint[] {
    return getRSIDivergenceParameterConstraints();
  }

  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = getRSIDivergenceConfigWithDefaults(context.config);
    return context.coins.some((coin) => hasEnoughDataForRSIDivergence(context.priceData[coin.id], config));
  }
}
