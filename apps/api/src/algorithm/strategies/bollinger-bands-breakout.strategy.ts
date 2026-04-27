import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import {
  buildBollingerBreakoutExitConfig,
  getBollingerBreakoutConfigSchema,
  getBollingerBreakoutConfigWithDefaults,
  getBollingerBreakoutIndicatorRequirements,
  getBollingerBreakoutMinDataPoints,
  getBollingerBreakoutParameterConstraints,
  hasEnoughDataForBollingerBreakout
} from './bollinger-bands-breakout-config';
import { generateBollingerBreakoutSignal, prepareBollingerChartData } from './bollinger-bands-breakout-signal.util';

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
 * Bollinger Bands Breakout Strategy
 *
 * Trades breakouts when price closes outside Bollinger Bands.
 * Buy signal when price breaks above upper band (momentum breakout).
 * Sell signal when price breaks below lower band (breakdown).
 *
 * NOTE: This is OPPOSITE to mean reversion - we trade WITH the breakout.
 *
 * Uses centralized IndicatorService for Bollinger Bands calculations with caching.
 */
@Injectable()
export class BollingerBandsBreakoutStrategy extends BaseAlgorithmStrategy implements IIndicatorProvider {
  readonly id = 'bb-breakout-001';

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
   * Execute the Bollinger Bands Breakout strategy
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      const config = getBollingerBreakoutConfigWithDefaults(context.config);
      const isBacktest = !!(
        context.metadata?.backtestId ||
        context.metadata?.isOptimization ||
        context.metadata?.isLiveReplay
      );
      const skipCache = this.shouldSkipIndicatorCache(context);

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!hasEnoughDataForBollingerBreakout(priceHistory, config)) {
          this.logger.debug(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Dual-path: try precomputed indicators first, fall back to IndicatorService
        const bbKey = `bb_${config.period}_${config.stdDev}`;
        const preUpper = this.getPrecomputedSlice(context, coin.id, `${bbKey}_upper`, priceHistory.length);
        let upper: number[], middle: number[], lower: number[], pb: number[], bandwidth: number[];

        const preMiddle = preUpper
          ? this.getPrecomputedSlice(context, coin.id, `${bbKey}_middle`, priceHistory.length)
          : null;
        const preLower = preUpper
          ? this.getPrecomputedSlice(context, coin.id, `${bbKey}_lower`, priceHistory.length)
          : null;
        const prePb = preUpper ? this.getPrecomputedSlice(context, coin.id, `${bbKey}_pb`, priceHistory.length) : null;
        const preBandwidth = preUpper
          ? this.getPrecomputedSlice(context, coin.id, `${bbKey}_bandwidth`, priceHistory.length)
          : null;

        if (preUpper && preMiddle && preLower && prePb && preBandwidth) {
          upper = preUpper;
          middle = preMiddle;
          lower = preLower;
          pb = prePb;
          bandwidth = preBandwidth;
        } else {
          if (preUpper) {
            this.logger.warn(`Partial BB cache for ${coin.symbol} (${bbKey}), recalculating`);
          }
          const bbResult = await this.indicatorService.calculateBollingerBands(
            {
              coinId: coin.id,
              prices: priceHistory,
              period: config.period,
              stdDev: config.stdDev,
              skipCache
            },
            this
          );
          ({ upper, middle, lower, pb, bandwidth } = bbResult);
        }

        const signal = generateBollingerBreakoutSignal(
          coin.id,
          coin.symbol,
          priceHistory,
          upper,
          middle,
          lower,
          pb,
          bandwidth,
          config
        );

        if (signal && signal.confidence >= config.minConfidence) {
          const adxCtx: AdxGateContext = {
            indicatorService: this.indicatorService,
            getPrecomputedSlice: (coinId, key, length) => this.getPrecomputedSlice(context, coinId, key, length),
            provider: this,
            logger: this.logger,
            isBacktest,
            skipCache
          };
          const gateResult = await applyAdxGate(adxCtx, coin, priceHistory, signal, config);
          if (gateResult) signals.push(gateResult);
        }

        if (!isBacktest) {
          chartData[coin.id] = prepareBollingerChartData(priceHistory, upper, middle, lower, pb, bandwidth);
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
        buildBollingerBreakoutExitConfig(config)
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Bollinger Bands Breakout strategy execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message);
    }
  }

  getMinDataPoints(config: Record<string, unknown>): number {
    return getBollingerBreakoutMinDataPoints(config);
  }

  getIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
    return getBollingerBreakoutIndicatorRequirements(config);
  }

  getConfigSchema(): Record<string, unknown> {
    return getBollingerBreakoutConfigSchema(super.getConfigSchema());
  }

  getParameterConstraints(): ParameterConstraint[] {
    return getBollingerBreakoutParameterConstraints();
  }

  /**
   * Enhanced validation for Bollinger Bands Breakout strategy
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    const config = getBollingerBreakoutConfigWithDefaults(context.config);
    return context.coins.some((coin) => hasEnoughDataForBollingerBreakout(context.priceData[coin.id], config));
  }
}
