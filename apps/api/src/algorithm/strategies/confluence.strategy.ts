import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { IIndicatorProvider, IndicatorCalculatorMap, IndicatorService } from '../indicators';
import {
  AlgorithmContext,
  AlgorithmResult,
  ChartDataPoint,
  ConfluenceConfig,
  ConfluenceScore,
  IndicatorSignal,
  SignalType,
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
 * - Mean Reversion: Bollinger Bands (identify extremes)
 *
 * Signals are only generated when minConfluence indicators agree.
 *
 * BUY: EMA12 > EMA26 + RSI < 40 + MACD positive + ATR normal + BB %B < 0.2
 * SELL: EMA12 < EMA26 + RSI > 60 + MACD negative + ATR normal + BB %B > 0.8
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

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!this.hasEnoughData(priceHistory, config)) {
          this.logger.warn(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate confluence score for this coin
        const confluenceScore = await this.calculateConfluenceScore(coin.id, priceHistory, config);

        // Generate trading signal if confluence is met
        const currentPrice = priceHistory[priceHistory.length - 1].avg;
        const tradingSignal = this.generateSignalFromConfluence(
          coin.id,
          coin.symbol,
          currentPrice,
          confluenceScore,
          config
        );

        if (tradingSignal) {
          signals.push(tradingSignal);
        }

        // Prepare chart data with all indicator values
        const chartDataForCoin = await this.prepareChartData(coin.id, priceHistory, config);
        chartData[coin.id] = chartDataForCoin;
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });
    } catch (error) {
      this.logger.error(`Confluence strategy execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Get configuration with defaults
   */
  private getConfigWithDefaults(config: Record<string, unknown>): ConfluenceConfig {
    return {
      minConfluence: (config.minConfluence as number) || 3,
      minConfidence: (config.minConfidence as number) || 0.65,

      ema: {
        enabled: config.emaEnabled !== false,
        fastPeriod: (config.emaFastPeriod as number) || 12,
        slowPeriod: (config.emaSlowPeriod as number) || 26
      },

      rsi: {
        enabled: config.rsiEnabled !== false,
        period: (config.rsiPeriod as number) || 14,
        buyThreshold: (config.rsiBuyThreshold as number) || 40,
        sellThreshold: (config.rsiSellThreshold as number) || 60
      },

      macd: {
        enabled: config.macdEnabled !== false,
        fastPeriod: (config.macdFastPeriod as number) || 12,
        slowPeriod: (config.macdSlowPeriod as number) || 26,
        signalPeriod: (config.macdSignalPeriod as number) || 9
      },

      atr: {
        enabled: config.atrEnabled !== false,
        period: (config.atrPeriod as number) || 14,
        volatilityThresholdMultiplier: (config.atrVolatilityMultiplier as number) || 1.5
      },

      bollingerBands: {
        enabled: config.bbEnabled !== false,
        period: (config.bbPeriod as number) || 20,
        stdDev: (config.bbStdDev as number) || 2,
        buyThreshold: (config.bbBuyThreshold as number) || 0.2,
        sellThreshold: (config.bbSellThreshold as number) || 0.8
      }
    };
  }

  /**
   * Check if we have enough data for all enabled indicator calculations
   */
  private hasEnoughData(priceHistory: PriceSummary[] | undefined, config: ConfluenceConfig): boolean {
    if (!priceHistory || priceHistory.length === 0) {
      return false;
    }

    // Calculate minimum required data points for each enabled indicator
    const requirements: number[] = [];

    if (config.ema.enabled) {
      requirements.push(config.ema.slowPeriod + 1);
    }

    if (config.rsi.enabled) {
      requirements.push(config.rsi.period + 1);
    }

    if (config.macd.enabled) {
      requirements.push(config.macd.slowPeriod + config.macd.signalPeriod);
    }

    if (config.atr.enabled) {
      requirements.push(config.atr.period + 1);
    }

    if (config.bollingerBands.enabled) {
      requirements.push(config.bollingerBands.period + 1);
    }

    const minRequired = requirements.length > 0 ? Math.max(...requirements) : 1;
    return priceHistory.length >= minRequired;
  }

  /**
   * Calculate confluence score by evaluating all enabled indicators
   */
  private async calculateConfluenceScore(
    coinId: string,
    prices: PriceSummary[],
    config: ConfluenceConfig
  ): Promise<ConfluenceScore> {
    const currentIndex = prices.length - 1;
    const signals: IndicatorSignal[] = [];
    let buyCount = 0;
    let sellCount = 0;
    let totalEnabled = 0;

    // Calculate all indicators in parallel for performance
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

    // Evaluate EMA (Trend)
    if (config.ema.enabled && ema12Result && ema26Result) {
      totalEnabled++;
      const emaSignal = this.evaluateEMASignal(ema12Result.values, ema26Result.values, currentIndex);
      signals.push(emaSignal);
      if (emaSignal.signal === 'bullish') buyCount++;
      else if (emaSignal.signal === 'bearish') sellCount++;
    }

    // Evaluate RSI (Momentum)
    if (config.rsi.enabled && rsiResult) {
      totalEnabled++;
      const rsiSignal = this.evaluateRSISignal(rsiResult.values, currentIndex, config.rsi);
      signals.push(rsiSignal);
      if (rsiSignal.signal === 'bullish') buyCount++;
      else if (rsiSignal.signal === 'bearish') sellCount++;
    }

    // Evaluate MACD (Oscillator)
    if (config.macd.enabled && macdResult) {
      totalEnabled++;
      // Pre-calculate histogram average for strength normalization (more efficient than recalculating in method)
      const histogramAvg = this.calculateArrayAverage(macdResult.histogram, currentIndex, 20, true);
      const macdSignal = this.evaluateMACDSignal(
        macdResult.macd,
        macdResult.signal,
        macdResult.histogram,
        currentIndex,
        histogramAvg.average
      );
      signals.push(macdSignal);
      if (macdSignal.signal === 'bullish') buyCount++;
      else if (macdSignal.signal === 'bearish') sellCount++;
    }

    // Evaluate Bollinger Bands (Mean Reversion)
    if (config.bollingerBands.enabled && bbResult) {
      totalEnabled++;
      const bbSignal = this.evaluateBollingerBandsSignal(
        bbResult.pb,
        bbResult.bandwidth,
        currentIndex,
        config.bollingerBands
      );
      signals.push(bbSignal);
      if (bbSignal.signal === 'bullish') buyCount++;
      else if (bbSignal.signal === 'bearish') sellCount++;
    }

    // Evaluate ATR (Volatility Filter) - purely a filter, not a directional indicator
    let isVolatilityFiltered = false;
    if (config.atr.enabled && atrResult) {
      // Note: ATR does NOT increment totalEnabled because it's a filter, not a directional indicator
      // Pre-calculate ATR average for volatility comparison (more efficient than recalculating in method)
      const atrAvg = this.calculateArrayAverage(atrResult.values, currentIndex, config.atr.period);
      const atrSignal = this.evaluateATRSignal(atrResult.values, currentIndex, config.atr, atrAvg.average);
      signals.push(atrSignal);

      // ATR only filters - when volatility is too high, signals are blocked
      if (atrSignal.signal === 'filtered') {
        isVolatilityFiltered = true;
      }
      // When volatility is normal, ATR simply allows signals to pass without contributing to confluence count
    }

    // Determine direction based on confluence
    let direction: 'buy' | 'sell' | 'hold' = 'hold';
    let confluenceCount = 0;

    if (buyCount >= config.minConfluence && buyCount > sellCount && !isVolatilityFiltered) {
      direction = 'buy';
      confluenceCount = buyCount;
    } else if (sellCount >= config.minConfluence && sellCount > buyCount && !isVolatilityFiltered) {
      direction = 'sell';
      confluenceCount = sellCount;
    }

    // Calculate average strength of agreeing signals
    const agreeingSignals = signals.filter(
      (s) =>
        (direction === 'buy' && s.signal === 'bullish') ||
        (direction === 'sell' && s.signal === 'bearish') ||
        s.signal === 'neutral' // ATR neutral counts for both
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
   * Utility: Calculate average of valid (non-NaN) values in array slice
   * Uses absolute values if specified (for histogram normalization)
   */
  private calculateArrayAverage(
    values: number[],
    endIndex: number,
    lookback: number,
    useAbsolute = false
  ): { average: number; count: number } {
    let sum = 0;
    let count = 0;
    const startIndex = Math.max(0, endIndex - lookback);

    for (let i = startIndex; i <= endIndex; i++) {
      const value = values[i];
      if (!isNaN(value)) {
        sum += useAbsolute ? Math.abs(value) : value;
        count++;
      }
    }

    return {
      average: count > 0 ? sum / count : 0,
      count
    };
  }

  /**
   * EMA Trend Evaluation
   * Bullish: EMA12 > EMA26 (uptrend)
   * Bearish: EMA12 < EMA26 (downtrend)
   */
  private evaluateEMASignal(ema12: number[], ema26: number[], currentIndex: number): IndicatorSignal {
    const currentEma12 = ema12[currentIndex];
    const currentEma26 = ema26[currentIndex];
    const previousEma12 = ema12[currentIndex - 1];
    const previousEma26 = ema26[currentIndex - 1];

    if (isNaN(currentEma12) || isNaN(currentEma26)) {
      return {
        name: 'EMA',
        signal: 'neutral',
        strength: 0,
        reason: 'Insufficient data for EMA calculation',
        values: { ema12: currentEma12, ema26: currentEma26 }
      };
    }

    const spread = (currentEma12 - currentEma26) / currentEma26;
    const isCrossover =
      !isNaN(previousEma12) &&
      !isNaN(previousEma26) &&
      ((previousEma12 <= previousEma26 && currentEma12 > currentEma26) ||
        (previousEma12 >= previousEma26 && currentEma12 < currentEma26));

    // Strength based on spread magnitude and crossover
    const spreadStrength = Math.min(1, Math.abs(spread) * 20); // 5% spread = max
    const crossoverBonus = isCrossover ? 0.2 : 0;
    const strength = Math.min(1, spreadStrength + crossoverBonus);

    if (currentEma12 > currentEma26) {
      return {
        name: 'EMA',
        signal: 'bullish',
        strength,
        reason: `Bullish trend: EMA12 (${currentEma12.toFixed(2)}) > EMA26 (${currentEma26.toFixed(2)})`,
        values: { ema12: currentEma12, ema26: currentEma26, spread: spread * 100 }
      };
    } else {
      return {
        name: 'EMA',
        signal: 'bearish',
        strength,
        reason: `Bearish trend: EMA12 (${currentEma12.toFixed(2)}) < EMA26 (${currentEma26.toFixed(2)})`,
        values: { ema12: currentEma12, ema26: currentEma26, spread: spread * 100 }
      };
    }
  }

  /**
   * RSI Momentum Evaluation
   * Bullish: RSI < buyThreshold (room to run up)
   * Bearish: RSI > sellThreshold (room to fall)
   */
  private evaluateRSISignal(
    rsi: number[],
    currentIndex: number,
    config: { buyThreshold: number; sellThreshold: number }
  ): IndicatorSignal {
    const currentRSI = rsi[currentIndex];

    if (isNaN(currentRSI)) {
      return {
        name: 'RSI',
        signal: 'neutral',
        strength: 0,
        reason: 'Insufficient data for RSI calculation',
        values: { rsi: currentRSI }
      };
    }

    // For BUY: RSI < 40 means room to run (not overbought)
    // For SELL: RSI > 60 means room to fall (not oversold)
    if (currentRSI < config.buyThreshold) {
      const strength = (config.buyThreshold - currentRSI) / config.buyThreshold;
      return {
        name: 'RSI',
        signal: 'bullish',
        strength: Math.min(1, strength + 0.3),
        reason: `Bullish momentum: RSI (${currentRSI.toFixed(2)}) < ${config.buyThreshold} (room to run)`,
        values: { rsi: currentRSI, threshold: config.buyThreshold }
      };
    } else if (currentRSI > config.sellThreshold) {
      const strength = (currentRSI - config.sellThreshold) / (100 - config.sellThreshold);
      return {
        name: 'RSI',
        signal: 'bearish',
        strength: Math.min(1, strength + 0.3),
        reason: `Bearish momentum: RSI (${currentRSI.toFixed(2)}) > ${config.sellThreshold} (room to fall)`,
        values: { rsi: currentRSI, threshold: config.sellThreshold }
      };
    } else {
      return {
        name: 'RSI',
        signal: 'neutral',
        strength: 0.3,
        reason: `Neutral momentum: RSI (${currentRSI.toFixed(2)}) in neutral zone`,
        values: { rsi: currentRSI }
      };
    }
  }

  /**
   * MACD Oscillator Evaluation
   * Bullish: MACD > Signal (positive histogram) AND positive momentum
   * Bearish: MACD < Signal (negative histogram) AND negative momentum
   *
   * @param avgHistogram Pre-calculated average histogram (absolute values) for normalization
   */
  private evaluateMACDSignal(
    macd: number[],
    signal: number[],
    histogram: number[],
    currentIndex: number,
    avgHistogram: number
  ): IndicatorSignal {
    const currentMACD = macd[currentIndex];
    const currentSignal = signal[currentIndex];
    const currentHistogram = histogram[currentIndex];
    const previousHistogram = histogram[currentIndex - 1];

    if (isNaN(currentMACD) || isNaN(currentSignal) || isNaN(currentHistogram)) {
      return {
        name: 'MACD',
        signal: 'neutral',
        strength: 0,
        reason: 'Insufficient data for MACD calculation',
        values: { macd: currentMACD, signal: currentSignal, histogram: currentHistogram }
      };
    }

    // Calculate histogram momentum (increasing or decreasing)
    const histogramMomentum = !isNaN(previousHistogram) ? currentHistogram - previousHistogram : 0;

    // Use pre-calculated average, fallback to current value if zero
    const effectiveAvg = avgHistogram > 0 ? avgHistogram : Math.abs(currentHistogram);
    const normalizedStrength = effectiveAvg > 0 ? Math.min(1, Math.abs(currentHistogram) / (effectiveAvg * 2)) : 0.5;

    if (currentHistogram > 0 && histogramMomentum >= 0) {
      return {
        name: 'MACD',
        signal: 'bullish',
        strength: Math.min(1, normalizedStrength + 0.3),
        reason: `Bullish oscillator: MACD histogram positive (${currentHistogram.toFixed(4)}) with upward momentum`,
        values: { macd: currentMACD, signal: currentSignal, histogram: currentHistogram }
      };
    } else if (currentHistogram < 0 && histogramMomentum <= 0) {
      return {
        name: 'MACD',
        signal: 'bearish',
        strength: Math.min(1, normalizedStrength + 0.3),
        reason: `Bearish oscillator: MACD histogram negative (${currentHistogram.toFixed(4)}) with downward momentum`,
        values: { macd: currentMACD, signal: currentSignal, histogram: currentHistogram }
      };
    } else {
      return {
        name: 'MACD',
        signal: 'neutral',
        strength: 0.3,
        reason: `Mixed oscillator: MACD histogram (${currentHistogram.toFixed(4)}) with conflicting momentum`,
        values: { macd: currentMACD, signal: currentSignal, histogram: currentHistogram }
      };
    }
  }

  /**
   * ATR Volatility Filter Evaluation
   * Neutral: ATR <= average ATR * multiplier (allow signals)
   * Filtered: ATR > average ATR * multiplier (filter out signals - market too choppy)
   *
   * @param preCalculatedAvgATR Pre-calculated average ATR for efficiency
   */
  private evaluateATRSignal(
    atr: number[],
    currentIndex: number,
    config: { period: number; volatilityThresholdMultiplier: number },
    preCalculatedAvgATR: number
  ): IndicatorSignal {
    const currentATR = atr[currentIndex];

    if (isNaN(currentATR)) {
      return {
        name: 'ATR',
        signal: 'neutral',
        strength: 0.5,
        reason: 'Insufficient data for ATR calculation',
        values: { atr: currentATR }
      };
    }

    // Use pre-calculated average, fallback to current value if zero
    const avgATR = preCalculatedAvgATR > 0 ? preCalculatedAvgATR : currentATR;
    const volatilityRatio = avgATR > 0 ? currentATR / avgATR : 1;
    const threshold = config.volatilityThresholdMultiplier;

    if (volatilityRatio > threshold) {
      // High volatility - filter out signals
      return {
        name: 'ATR',
        signal: 'filtered',
        strength: 0,
        reason: `High volatility: ATR (${currentATR.toFixed(4)}) is ${(volatilityRatio * 100).toFixed(0)}% of average (threshold: ${(threshold * 100).toFixed(0)}%)`,
        values: { atr: currentATR, avgAtr: avgATR, ratio: volatilityRatio }
      };
    } else {
      // Normal volatility - allow signals with strength based on stability
      const stabilityStrength = 1 - volatilityRatio / threshold;
      return {
        name: 'ATR',
        signal: 'neutral', // ATR doesn't indicate direction, just filters
        strength: Math.max(0.4, stabilityStrength),
        reason: `Normal volatility: ATR (${currentATR.toFixed(4)}) is ${(volatilityRatio * 100).toFixed(0)}% of average`,
        values: { atr: currentATR, avgAtr: avgATR, ratio: volatilityRatio }
      };
    }
  }

  /**
   * Bollinger Bands Mean Reversion Evaluation
   * Bullish: %B < buyThreshold (price near/below lower band)
   * Bearish: %B > sellThreshold (price near/above upper band)
   */
  private evaluateBollingerBandsSignal(
    pb: number[],
    bandwidth: number[],
    currentIndex: number,
    config: { buyThreshold: number; sellThreshold: number }
  ): IndicatorSignal {
    const currentPB = pb[currentIndex];
    const currentBandwidth = bandwidth[currentIndex];

    if (isNaN(currentPB) || isNaN(currentBandwidth)) {
      return {
        name: 'BB',
        signal: 'neutral',
        strength: 0,
        reason: 'Insufficient data for Bollinger Bands calculation',
        values: { percentB: currentPB, bandwidth: currentBandwidth }
      };
    }

    // %B < 0.2 = near lower band = bullish (mean reversion up expected)
    // %B > 0.8 = near upper band = bearish (mean reversion down expected)
    if (currentPB < config.buyThreshold) {
      const strength = (config.buyThreshold - currentPB) / config.buyThreshold;
      return {
        name: 'BB',
        signal: 'bullish',
        strength: Math.min(1, strength + 0.4),
        reason: `Bullish mean reversion: %B (${currentPB.toFixed(2)}) < ${config.buyThreshold} (near lower band)`,
        values: { percentB: currentPB, bandwidth: currentBandwidth, threshold: config.buyThreshold }
      };
    } else if (currentPB > config.sellThreshold) {
      const strength = (currentPB - config.sellThreshold) / (1 - config.sellThreshold);
      return {
        name: 'BB',
        signal: 'bearish',
        strength: Math.min(1, strength + 0.4),
        reason: `Bearish mean reversion: %B (${currentPB.toFixed(2)}) > ${config.sellThreshold} (near upper band)`,
        values: { percentB: currentPB, bandwidth: currentBandwidth, threshold: config.sellThreshold }
      };
    } else {
      return {
        name: 'BB',
        signal: 'neutral',
        strength: 0.3,
        reason: `Neutral position: %B (${currentPB.toFixed(2)}) within bands`,
        values: { percentB: currentPB, bandwidth: currentBandwidth }
      };
    }
  }

  /**
   * Generate trading signal from confluence score
   */
  private generateSignalFromConfluence(
    coinId: string,
    coinSymbol: string,
    price: number,
    confluenceScore: ConfluenceScore,
    config: ConfluenceConfig
  ): TradingSignal | null {
    if (confluenceScore.direction === 'hold') {
      return null;
    }

    const strength = this.calculateSignalStrength(confluenceScore);
    const confidence = this.calculateConfidence(confluenceScore, config);

    if (confidence < config.minConfidence) {
      return null;
    }

    const signalType = confluenceScore.direction === 'buy' ? SignalType.BUY : SignalType.SELL;

    // Build detailed reason from individual signals
    const agreeingIndicators = confluenceScore.signals
      .filter(
        (s) =>
          (confluenceScore.direction === 'buy' && s.signal === 'bullish') ||
          (confluenceScore.direction === 'sell' && s.signal === 'bearish')
      )
      .map((s) => s.name);

    const reason = `Confluence ${signalType}: ${confluenceScore.confluenceCount}/${confluenceScore.totalEnabled} indicators agree (${agreeingIndicators.join(', ')})`;

    // Build metadata from all indicator values
    const metadata: Record<string, unknown> = {
      symbol: coinSymbol,
      confluenceCount: confluenceScore.confluenceCount,
      totalEnabled: confluenceScore.totalEnabled,
      agreeingIndicators,
      isVolatilityFiltered: confluenceScore.isVolatilityFiltered,
      indicatorBreakdown: confluenceScore.signals.map((s) => ({
        name: s.name,
        signal: s.signal,
        strength: s.strength,
        reason: s.reason,
        values: s.values
      }))
    };

    return {
      type: signalType,
      coinId,
      strength,
      price,
      confidence,
      reason,
      metadata
    };
  }

  /**
   * Calculate signal strength from confluence score
   */
  private calculateSignalStrength(confluenceScore: ConfluenceScore): number {
    // Strength based on:
    // 1. Average strength of agreeing indicators
    // 2. Confluence ratio (how many agree vs total)
    const confluenceRatio =
      confluenceScore.totalEnabled > 0 ? confluenceScore.confluenceCount / confluenceScore.totalEnabled : 0;

    return Math.min(1, confluenceScore.averageStrength * 0.6 + confluenceRatio * 0.4);
  }

  /**
   * Calculate confidence from confluence score
   */
  private calculateConfidence(confluenceScore: ConfluenceScore, config: ConfluenceConfig): number {
    // Base confidence from confluence level
    const confluenceRatio =
      confluenceScore.totalEnabled > 0 ? confluenceScore.confluenceCount / confluenceScore.totalEnabled : 0;
    const baseConfidence = 0.4 + confluenceRatio * 0.4; // 40% base + up to 40% from confluence

    // Bonus for exceeding minimum confluence
    const excessConfluence = Math.max(0, confluenceScore.confluenceCount - config.minConfluence);
    const confluenceBonus = excessConfluence * 0.1; // 10% per extra agreeing indicator

    // Strength contribution
    const strengthBonus = confluenceScore.averageStrength * 0.2; // Up to 20% from strength

    return Math.min(1, baseConfidence + confluenceBonus + strengthBonus);
  }

  /**
   * Prepare chart data for visualization
   */
  private async prepareChartData(
    coinId: string,
    prices: PriceSummary[],
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
        // Mean reversion indicators
        bbUpper: bbResult?.upper[index],
        bbMiddle: bbResult?.middle[index],
        bbLower: bbResult?.lower[index],
        percentB: bbResult?.pb[index],
        bandwidth: bbResult?.bandwidth[index]
      }
    }));
  }

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),

      // Core confluence settings
      minConfluence: {
        type: 'number',
        default: 3,
        min: 2,
        max: 4,
        description: 'Minimum number of directional indicators that must agree (2-4). ATR is a filter only.'
      },
      minConfidence: {
        type: 'number',
        default: 0.65,
        min: 0,
        max: 1,
        description: 'Minimum confidence required to generate signal'
      },

      // EMA (Trend) settings
      emaEnabled: { type: 'boolean', default: true, description: 'Enable EMA trend indicator' },
      emaFastPeriod: { type: 'number', default: 12, min: 5, max: 20, description: 'Fast EMA period' },
      emaSlowPeriod: { type: 'number', default: 26, min: 15, max: 50, description: 'Slow EMA period' },

      // RSI (Momentum) settings
      rsiEnabled: { type: 'boolean', default: true, description: 'Enable RSI momentum indicator' },
      rsiPeriod: { type: 'number', default: 14, min: 5, max: 30, description: 'RSI calculation period' },
      rsiBuyThreshold: {
        type: 'number',
        default: 40,
        min: 20,
        max: 50,
        description: 'RSI threshold for bullish (RSI < threshold)'
      },
      rsiSellThreshold: {
        type: 'number',
        default: 60,
        min: 50,
        max: 80,
        description: 'RSI threshold for bearish (RSI > threshold)'
      },

      // MACD (Oscillator) settings
      macdEnabled: { type: 'boolean', default: true, description: 'Enable MACD oscillator indicator' },
      macdFastPeriod: { type: 'number', default: 12, min: 5, max: 20, description: 'MACD fast EMA period' },
      macdSlowPeriod: { type: 'number', default: 26, min: 15, max: 50, description: 'MACD slow EMA period' },
      macdSignalPeriod: { type: 'number', default: 9, min: 5, max: 15, description: 'MACD signal line period' },

      // ATR (Volatility) settings
      atrEnabled: { type: 'boolean', default: true, description: 'Enable ATR volatility filter' },
      atrPeriod: { type: 'number', default: 14, min: 5, max: 30, description: 'ATR calculation period' },
      atrVolatilityMultiplier: {
        type: 'number',
        default: 1.5,
        min: 1.0,
        max: 3.0,
        description: 'ATR threshold multiplier (filter when ATR > avg * multiplier)'
      },

      // Bollinger Bands (Mean Reversion) settings
      bbEnabled: { type: 'boolean', default: true, description: 'Enable Bollinger Bands mean reversion indicator' },
      bbPeriod: { type: 'number', default: 20, min: 10, max: 50, description: 'Bollinger Bands calculation period' },
      bbStdDev: { type: 'number', default: 2, min: 1, max: 3, description: 'Standard deviation multiplier' },
      bbBuyThreshold: {
        type: 'number',
        default: 0.2,
        min: 0,
        max: 0.5,
        description: '%B threshold for bullish (< value = near lower band)'
      },
      bbSellThreshold: {
        type: 'number',
        default: 0.8,
        min: 0.5,
        max: 1,
        description: '%B threshold for bearish (> value = near upper band)'
      }
    };
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
