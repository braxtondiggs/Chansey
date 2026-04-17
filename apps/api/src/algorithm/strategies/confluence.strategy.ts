import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import {
  calculateMinDataPoints,
  getConfluenceConfigSchema,
  getConfluenceConfigWithDefaults,
  getConfluenceIndicatorRequirements,
  getConfluenceParameterConstraints
} from './confluence-config';
import {
  calculateArrayAverage,
  evaluateATRSignal,
  evaluateBollingerBandsSignal,
  evaluateEMASignal,
  evaluateMACDSignal,
  evaluateRSISignal
} from './confluence-evaluators.util';
import { resolveIndicatorData } from './confluence-indicators.util';
import { generateSignalFromConfluence } from './confluence-signals.util';

import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { toErrorInfo } from '../../shared/error.util';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorRequirement, IndicatorService } from '../indicators';
import {
  AlgorithmContext,
  AlgorithmResult,
  ChartDataPoint,
  ConfluenceConfig,
  ConfluenceScore,
  IndicatorSignal,
  TradingSignal
} from '../interfaces';

/**
 * Multi-Indicator Confluence Strategy
 *
 * Combines five indicator families to reduce false positives:
 * - Trend: EMA 12/26 crossover (direction)
 * - Momentum: RSI 14 (overbought/oversold conditions)
 * - Oscillator: MACD (confirm trend momentum)
 * - Volatility: ATR 14 (filter choppy markets)
 * - Trend Confirmation: Bollinger Bands (breakout/breakdown via %B)
 *
 * Signals are only generated when minConfluence indicators agree.
 * BUY and SELL use symmetric confluence thresholds by default.
 *
 * BUY (minConfluence=2): EMA12 > EMA26 + RSI > 55 + MACD positive + ATR normal + BB %B > 0.55
 * SELL (minSellConfluence=2): EMA12 < EMA26 + RSI < 45 + MACD negative + ATR normal + BB %B < 0.45
 */
@Injectable()
export class ConfluenceStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'confluence-001';

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
   * Execute the Multi-Indicator Confluence strategy
   */
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

        // Calculate confluence score for this coin
        const confluenceScore = await this.calculateConfluenceScore(context, coin.id, priceHistory, config, skipCache);

        // Generate trading signal if confluence is met
        const currentPrice = priceHistory[priceHistory.length - 1].avg;
        const isFuturesShort = config.enableShortSignals && context.metadata?.marketType === 'futures';
        const tradingSignal = generateSignalFromConfluence(
          coin.id,
          coin.symbol,
          currentPrice,
          confluenceScore,
          config,
          isFuturesShort
        );

        if (tradingSignal) {
          signals.push(tradingSignal);
        }

        // Skip chart data in backtest/optimization to avoid massive allocations
        if (!isBacktest) {
          const chartDataForCoin = await this.prepareChartData(coin.id, priceHistory, config);
          chartData[coin.id] = chartDataForCoin;
        }
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Confluence strategy execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  protected getConfigWithDefaults(config: Record<string, unknown>): ConfluenceConfig {
    return getConfluenceConfigWithDefaults(config);
  }

  /**
   * Check if we have enough data for all enabled indicator calculations
   */
  private hasEnoughData(priceHistory: CandleData[] | undefined, config: ConfluenceConfig): boolean {
    if (!priceHistory || priceHistory.length === 0) {
      return false;
    }
    return priceHistory.length >= calculateMinDataPoints(config);
  }

  /**
   * Calculate confluence score by evaluating all enabled indicators
   */
  private async calculateConfluenceScore(
    context: AlgorithmContext,
    coinId: string,
    prices: CandleData[],
    config: ConfluenceConfig,
    skipCache = false
  ): Promise<ConfluenceScore> {
    const currentIndex = prices.length - 1;
    const signals: IndicatorSignal[] = [];
    let buyCount = 0;
    let sellCount = 0;
    let totalEnabled = 0;
    // Resolve all indicator data (precomputed fast-path or IndicatorService fallback)
    const indicators = await resolveIndicatorData({
      config,
      coinId,
      prices,
      skipCache,
      getPrecomputedSlice: this.getPrecomputedSlice.bind(this),
      indicatorService: this.indicatorService,
      indicatorProvider: this,
      context
    });

    const { ema12: ema12Values, ema26: ema26Values, rsi: rsiValues } = indicators;
    const { macd: macdValues, macdSignal: macdSignalValues, macdHistogram: macdHistogramValues } = indicators;
    const { atr: atrValues, bbPb: bbPbValues, bbBandwidth: bbBandwidthValues } = indicators;

    // Evaluate EMA (Trend)
    if (config.ema.enabled && ema12Values && ema26Values) {
      totalEnabled++;
      const emaSignal = evaluateEMASignal(ema12Values, ema26Values, currentIndex);
      signals.push(emaSignal);
      if (emaSignal.signal === 'bullish') buyCount++;
      else if (emaSignal.signal === 'bearish') sellCount++;
    }

    // Evaluate RSI (Momentum)
    if (config.rsi.enabled && rsiValues) {
      totalEnabled++;
      const rsiSignal = evaluateRSISignal(rsiValues, currentIndex, config.rsi);
      signals.push(rsiSignal);
      if (rsiSignal.signal === 'bullish') buyCount++;
      else if (rsiSignal.signal === 'bearish') sellCount++;
    }

    // Evaluate MACD (Oscillator)
    if (config.macd.enabled && macdValues && macdSignalValues && macdHistogramValues) {
      totalEnabled++;
      // Pre-calculate histogram average for strength normalization (more efficient than recalculating in method)
      const histogramAvg = calculateArrayAverage(macdHistogramValues, currentIndex, 20, true);
      const macdSignal = evaluateMACDSignal(
        macdValues,
        macdSignalValues,
        macdHistogramValues,
        currentIndex,
        histogramAvg.average
      );
      signals.push(macdSignal);
      if (macdSignal.signal === 'bullish') buyCount++;
      else if (macdSignal.signal === 'bearish') sellCount++;
    }

    // Evaluate Bollinger Bands (Trend Confirmation)
    if (config.bollingerBands.enabled && bbPbValues && bbBandwidthValues) {
      totalEnabled++;
      const bbSignal = evaluateBollingerBandsSignal(bbPbValues, bbBandwidthValues, currentIndex, config.bollingerBands);
      signals.push(bbSignal);
      if (bbSignal.signal === 'bullish') buyCount++;
      else if (bbSignal.signal === 'bearish') sellCount++;
    }

    // Evaluate ATR (Volatility Filter) - purely a filter, not a directional indicator
    let isVolatilityFiltered = false;
    if (config.atr.enabled && atrValues) {
      // Note: ATR does NOT increment totalEnabled because it's a filter, not a directional indicator
      // Pre-calculate ATR average for volatility comparison (more efficient than recalculating in method)
      const atrAvg = calculateArrayAverage(atrValues, currentIndex, config.atr.period);
      const atrSignal = evaluateATRSignal(atrValues, currentIndex, config.atr, atrAvg.average);
      signals.push(atrSignal);

      // ATR only filters - when volatility is too high, signals are blocked
      if (atrSignal.signal === 'filtered') {
        isVolatilityFiltered = true;
      }
      // When volatility is normal, ATR simply allows signals to pass without contributing to confluence count
    }

    // Determine direction based on confluence
    // Symmetric thresholds by default: BUY and SELL require the same confluence count
    let direction: 'buy' | 'sell' | 'hold' = 'hold';
    let confluenceCount = 0;

    if (buyCount >= config.minConfluence && buyCount > sellCount && !isVolatilityFiltered) {
      direction = 'buy';
      confluenceCount = buyCount;
    } else if (sellCount >= config.minSellConfluence && sellCount > buyCount && !isVolatilityFiltered) {
      direction = 'sell';
      confluenceCount = sellCount;
    }

    // Calculate average strength using only directional signals that agree with the final direction
    // All non-directional signals (e.g., ATR filtered/neutral, RSI/BB neutral) are excluded
    const agreeingSignals = signals.filter(
      (s) => (direction === 'buy' && s.signal === 'bullish') || (direction === 'sell' && s.signal === 'bearish')
    );
    const averageStrength =
      agreeingSignals.length > 0 ? agreeingSignals.reduce((sum, s) => sum + s.strength, 0) / agreeingSignals.length : 0;

    return {
      direction,
      confluenceCount,
      totalEnabled,
      signals,
      averageStrength,
      isVolatilityFiltered
    };
  }

  /**
   * Prepare chart data for visualization
   */
  private async prepareChartData(
    coinId: string,
    prices: CandleData[],
    config: ConfluenceConfig
  ): Promise<ChartDataPoint[]> {
    // Calculate all indicators for chart data
    const [ema12Result, ema26Result, rsiResult, macdResult, atrResult, bbResult] = await Promise.all([
      config.ema.enabled
        ? this.indicatorService.calculateEMA({ coinId, prices, period: config.ema.fastPeriod }, this)
        : null,
      config.ema.enabled
        ? this.indicatorService.calculateEMA({ coinId, prices, period: config.ema.slowPeriod }, this)
        : null,
      config.rsi.enabled
        ? this.indicatorService.calculateRSI({ coinId, prices, period: config.rsi.period }, this)
        : null,
      config.macd.enabled
        ? this.indicatorService.calculateMACD(
            {
              coinId,
              prices,
              fastPeriod: config.macd.fastPeriod,
              slowPeriod: config.macd.slowPeriod,
              signalPeriod: config.macd.signalPeriod
            },
            this
          )
        : null,
      config.atr.enabled
        ? this.indicatorService.calculateATR({ coinId, prices, period: config.atr.period }, this)
        : null,
      config.bollingerBands.enabled
        ? this.indicatorService.calculateBollingerBands(
            { coinId, prices, period: config.bollingerBands.period, stdDev: config.bollingerBands.stdDev },
            this
          )
        : null
    ]);

    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        high: price.high,
        low: price.low,
        // Trend indicators
        ema12: ema12Result?.values[index],
        ema26: ema26Result?.values[index],
        // Momentum indicator
        rsi: rsiResult?.values[index],
        // Oscillator indicators
        macd: macdResult?.macd[index],
        macdSignal: macdResult?.signal[index],
        histogram: macdResult?.histogram[index],
        // Volatility indicator
        atr: atrResult?.values[index],
        // Trend confirmation indicators
        bbUpper: bbResult?.upper[index],
        bbMiddle: bbResult?.middle[index],
        bbLower: bbResult?.lower[index],
        percentB: bbResult?.pb[index],
        bandwidth: bbResult?.bandwidth[index]
      }
    }));
  }

  getConfigSchema(): Record<string, unknown> {
    return getConfluenceConfigSchema(super.getConfigSchema());
  }

  /**
   * Declare indicator requirements for precomputation during optimization.
   */
  getMinDataPoints(config: Record<string, unknown>): number {
    return calculateMinDataPoints(this.getConfigWithDefaults(config));
  }

  getIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
    return getConfluenceIndicatorRequirements(config);
  }

  getParameterConstraints(): ParameterConstraint[] {
    return getConfluenceParameterConstraints();
  }

  /**
   * Count enabled directional indicators (excludes ATR which is a filter only)
   */
  private countDirectionalIndicators(config: ConfluenceConfig): number {
    let count = 0;
    if (config.ema.enabled) count++;
    if (config.rsi.enabled) count++;
    if (config.macd.enabled) count++;
    if (config.bollingerBands.enabled) count++;
    // Note: ATR is excluded - it's a volatility filter, not a directional indicator
    return count;
  }

  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = this.getConfigWithDefaults(context.config);

    // Count only directional indicators (ATR is a filter, not directional)
    const directionalCount = this.countDirectionalIndicators(config);

    // Validate minConfluence doesn't exceed available directional indicators
    if (config.minConfluence > directionalCount) {
      this.logger.warn(
        `minConfluence (${config.minConfluence}) exceeds enabled directional indicators (${directionalCount}). ` +
          `No signals can be generated. Either reduce minConfluence or enable more indicators.`
      );
      return false;
    }

    // Validate minSellConfluence doesn't exceed available directional indicators
    if (config.minSellConfluence > directionalCount) {
      this.logger.warn(
        `minSellConfluence (${config.minSellConfluence}) exceeds enabled directional indicators (${directionalCount}). ` +
          `No SELL signals can be generated. Either reduce minSellConfluence or enable more indicators.`
      );
      return false;
    }

    // At least minConfluence directional indicators must be enabled
    if (directionalCount < config.minConfluence) {
      this.logger.warn(
        `Not enough indicators enabled (${directionalCount}) for minConfluence (${config.minConfluence})`
      );
      return false;
    }

    return context.coins.some((coin) => this.hasEnoughData(context.priceData[coin.id], config));
  }
}
