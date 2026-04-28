import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import {
  generateEntrySignal,
  generateStopSignal,
  prepareChartData,
  wasStopTriggeredRecently
} from './atr-trailing-stop-calc.util';
import {
  buildATRTrailingStopExitConfig,
  type Direction,
  getATRTrailingStopConfigSchema,
  getATRTrailingStopConfigWithDefaults,
  getATRTrailingStopIndicatorRequirements,
  getATRTrailingStopMinDataPoints,
  hasEnoughATRTrailingStopData
} from './atr-trailing-stop-config';

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
      const config = getATRTrailingStopConfigWithDefaults(context.config);
      const isBacktest = !!(
        context.metadata?.backtestId ||
        context.metadata?.isOptimization ||
        context.metadata?.isLiveReplay
      );
      const skipCache = this.shouldSkipIndicatorCache(context);

      const directions: Direction[] = config.tradeDirection === 'both' ? ['long', 'short'] : [config.tradeDirection];

      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];

        if (!hasEnoughATRTrailingStopData(priceHistory, config)) {
          this.logger.debug(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        const atr =
          this.getPrecomputedSlice(context, coin.id, `atr_${config.atrPeriod}`, priceHistory.length) ??
          (
            await this.indicatorService.calculateATR(
              { coinId: coin.id, prices: priceHistory, period: config.atrPeriod, skipCache },
              this
            )
          ).values;

        const exitConfig = buildATRTrailingStopExitConfig(config);

        for (const direction of directions) {
          const entry = generateEntrySignal(coin.id, coin.symbol, priceHistory, atr, config, direction);
          if (entry && entry.confidence >= config.minConfidence) {
            // Suppress entry if a stop was triggered within the cooldown window
            if (
              config.stopCooldownBars > 0 &&
              wasStopTriggeredRecently(priceHistory, atr, config, direction, config.stopCooldownBars)
            ) {
              continue;
            }
            entry.exitConfig = exitConfig;
            // Only entry signals are gated by ADX. Stop signals must always fire for risk management.
            const adxCtx: AdxGateContext = {
              indicatorService: this.indicatorService,
              getPrecomputedSlice: (coinId, key, length) => this.getPrecomputedSlice(context, coinId, key, length),
              provider: this,
              logger: this.logger,
              isBacktest,
              skipCache
            };
            const gatedEntry = await applyAdxGate(adxCtx, coin, priceHistory, entry, config);
            if (gatedEntry) signals.push(gatedEntry);
          }

          const stop = generateStopSignal(coin.id, coin.symbol, priceHistory, atr, config, direction);
          if (stop && stop.confidence >= config.minConfidence) {
            signals.push(stop);
          }
        }

        if (!isBacktest) {
          chartData[coin.id] = prepareChartData(priceHistory, atr, config);
        }
      }

      const resultExitConfig = buildATRTrailingStopExitConfig(getATRTrailingStopConfigWithDefaults(context.config));
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

  getMinDataPoints(config: Record<string, unknown>): number {
    return getATRTrailingStopMinDataPoints(config);
  }

  getIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
    return getATRTrailingStopIndicatorRequirements(config);
  }

  getConfigSchema(): Record<string, unknown> {
    return getATRTrailingStopConfigSchema(super.getConfigSchema());
  }

  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) return false;
    const config = getATRTrailingStopConfigWithDefaults(context.config);
    return context.coins.some((coin) => hasEnoughATRTrailingStopData(context.priceData[coin.id], config));
  }
}
