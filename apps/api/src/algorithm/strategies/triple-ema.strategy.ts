import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { generateTripleEMASignal, prepareTripleEMAChartData } from './triple-ema-calc.util';
import {
  buildTripleEMAExitConfig,
  getTripleEMAConfigSchema,
  getTripleEMAConfigWithDefaults,
  getTripleEMAIndicatorRequirements,
  getTripleEMAMinDataPoints,
  getTripleEMAParameterConstraints,
  hasEnoughTripleEMAData
} from './triple-ema-config';

import { ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
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
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, TradingSignal } from '../interfaces';

/**
 * Triple EMA Strategy
 *
 * Uses three EMAs (fast, medium, slow) to identify strong trends.
 * Strong bullish signal: Fast > Medium > Slow (all aligned bullish)
 * Strong bearish signal: Fast < Medium < Slow (all aligned bearish)
 *
 * Generates signals when EMA alignment changes, indicating trend shifts.
 *
 * Uses centralized IndicatorService for EMA calculations with caching.
 */
@Injectable()
export class TripleEMAStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'triple-ema-001';

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
   * Execute the Triple EMA strategy
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      const config = getTripleEMAConfigWithDefaults(context.config);
      const isBacktest = !!(
        context.metadata?.backtestId ||
        context.metadata?.isOptimization ||
        context.metadata?.isLiveReplay
      );
      const skipCache = this.shouldSkipIndicatorCache(context);

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!hasEnoughTripleEMAData(priceHistory, config)) {
          this.logger.debug(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate all three EMAs (precomputed fast path or IndicatorService fallback)
        const fastEMA =
          this.getPrecomputedSlice(context, coin.id, `ema_${config.fastPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateEMA(
              { coinId: coin.id, prices: priceHistory, period: config.fastPeriod, skipCache },
              this
            )
          ).values;
        const mediumEMA =
          this.getPrecomputedSlice(context, coin.id, `ema_${config.mediumPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateEMA(
              { coinId: coin.id, prices: priceHistory, period: config.mediumPeriod, skipCache },
              this
            )
          ).values;
        const slowEMA =
          this.getPrecomputedSlice(context, coin.id, `ema_${config.slowPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateEMA(
              { coinId: coin.id, prices: priceHistory, period: config.slowPeriod, skipCache },
              this
            )
          ).values;

        // Generate signal based on EMA alignment
        const signal = generateTripleEMASignal(coin.id, coin.symbol, priceHistory, fastEMA, mediumEMA, slowEMA, config);

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

        if (!isBacktest) {
          chartData[coin.id] = prepareTripleEMAChartData(priceHistory, fastEMA, mediumEMA, slowEMA);
        }
      }

      return this.createSuccessResult(
        signals,
        chartData,
        {
          algorithm: this.name,
          version: this.version,
          signalsGenerated: signals.length
        },
        buildTripleEMAExitConfig(config)
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Triple EMA strategy execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  getMinDataPoints(config: Record<string, unknown>): number {
    return getTripleEMAMinDataPoints(config);
  }

  getIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
    return getTripleEMAIndicatorRequirements(config);
  }

  getParameterConstraints(): ParameterConstraint[] {
    return getTripleEMAParameterConstraints();
  }

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return getTripleEMAConfigSchema(super.getConfigSchema());
  }

  /**
   * Enhanced validation for Triple EMA strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = getTripleEMAConfigWithDefaults(context.config);
    return context.coins.some((coin) => hasEnoughTripleEMAData(context.priceData[coin.id], config));
  }
}
