import { type Logger } from '@nestjs/common';

import { classifyAdxTrend } from './calculators/adx.calculator';
import { type IndicatorRequirement } from './indicator-requirements.interface';
import { type IIndicatorProvider } from './indicator.interface';
import { type IndicatorService } from './indicator.service';

import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { type TradingSignal } from '../interfaces';

/**
 * Latest ADX/+DI/-DI bundle. Returned by `getLatestAdxBundle` once and consumed by `applyAdxGate`.
 */
export interface AdxBundle {
  adx: number;
  pdi: number;
  mdi: number;
}

/**
 * Defaulted ADX gate parameters extracted from a strategy's raw config record.
 *
 * - `minAdx <= 0` disables the gate entirely.
 * - `adxStrongMin > minAdx` enables the tiered logic (weak band reduces signal strength).
 */
export interface AdxGateConfig {
  adxPeriod: number;
  minAdx: number;
  adxStrongMin: number;
  adxWeakMultiplier: number;
}

/**
 * Per-call dependencies the gate needs without coupling to BaseAlgorithmStrategy.
 */
export interface AdxGateContext {
  indicatorService: IndicatorService;
  /** Wraps `BaseAlgorithmStrategy.getPrecomputedSlice` so this util stays free of base-class coupling. */
  getPrecomputedSlice: (coinId: string, key: string, length: number) => number[] | undefined;
  /** Provider passed into `IndicatorService.calculateADX` so strategies can override the calculator. */
  provider?: IIndicatorProvider;
  logger: Logger;
  isBacktest: boolean;
  skipCache: boolean;
}

/** Build a fully-defaulted `AdxGateConfig` from a strategy's raw config record. */
export function getAdxGateConfigDefaults(config: Record<string, unknown>): AdxGateConfig {
  return {
    adxPeriod: (config.adxPeriod as number) ?? 14,
    minAdx: (config.minAdx as number) ?? 0,
    adxStrongMin: (config.adxStrongMin as number) ?? 0,
    adxWeakMultiplier: (config.adxWeakMultiplier as number) ?? 0.5
  };
}

/**
 * Schema entries the strategy spreads into its `getConfigSchema()` output.
 *
 * Kept in one place so all 7 trend strategies share identical bounds and descriptions.
 */
export function getAdxGateSchema(): Record<string, unknown> {
  return {
    adxPeriod: {
      type: 'number',
      default: 14,
      min: 7,
      max: 28,
      description: 'ADX lookback period for trend-strength gate'
    },
    minAdx: {
      type: 'number',
      default: 0,
      min: 0,
      max: 40,
      description: 'Minimum ADX to allow signals (0 = gate disabled)'
    },
    adxStrongMin: {
      type: 'number',
      default: 0,
      min: 0,
      max: 60,
      description: 'ADX threshold for "strong" tier (0 = tiered logic disabled)'
    },
    adxWeakMultiplier: {
      type: 'number',
      default: 0.5,
      min: 0.1,
      max: 1,
      description: 'Strength multiplier when minAdx ≤ ADX < adxStrongMin'
    }
  };
}

/**
 * Optional `IndicatorRequirement` entry for the ADX gate. Returns null when the gate is disabled.
 */
export function getAdxGateRequirement(config: Record<string, unknown>): IndicatorRequirement | null {
  const minAdx = (config.minAdx as number) ?? 0;
  if (minAdx <= 0) return null;
  return { type: 'ADX', paramKeys: ['adxPeriod'], defaultParams: { adxPeriod: 14 } };
}

/**
 * Fetch the latest ADX/+DI/-DI bundle, preferring a precomputed slice when available.
 * Returns null when ADX cannot be computed (insufficient data, calculator error, etc).
 */
export async function getLatestAdxBundle(
  ctx: AdxGateContext,
  coinId: string,
  priceHistory: CandleData[],
  period: number
): Promise<AdxBundle | null> {
  const adxSlice = ctx.getPrecomputedSlice(coinId, `adx_${period}`, 1);
  if (adxSlice && adxSlice.length > 0 && Number.isFinite(adxSlice[adxSlice.length - 1])) {
    const pdiSlice = ctx.getPrecomputedSlice(coinId, `adx_${period}_pdi`, 1);
    const mdiSlice = ctx.getPrecomputedSlice(coinId, `adx_${period}_mdi`, 1);
    return {
      adx: adxSlice[adxSlice.length - 1],
      pdi: pdiSlice && pdiSlice.length > 0 ? pdiSlice[pdiSlice.length - 1] : NaN,
      mdi: mdiSlice && mdiSlice.length > 0 ? mdiSlice[mdiSlice.length - 1] : NaN
    };
  }
  try {
    const result = await ctx.indicatorService.calculateADX(
      { coinId, prices: priceHistory, period, skipCache: ctx.skipCache },
      ctx.provider
    );
    const last = result.values.length - 1;
    const adx = result.values[last];
    if (!Number.isFinite(adx)) return null;
    return { adx, pdi: result.pdi?.[last] ?? NaN, mdi: result.mdi?.[last] ?? NaN };
  } catch (err) {
    ctx.logger.debug(`ADX calc failed for ${coinId}`, err);
    return null;
  }
}

/**
 * Apply the tiered ADX trend-strength gate.
 *
 * - `minAdx <= 0` → gate disabled, signal passes through unchanged.
 * - ADX missing or below `minAdx` → returns null (signal blocked).
 * - Tiered logic enabled (`adxStrongMin > minAdx`) and ADX in the weak band →
 *   strength multiplied by `adxWeakMultiplier` and metadata annotated.
 * - Otherwise (strong tier or tiered logic disabled) → metadata annotated, strength preserved.
 *
 * The returned signal is always a fresh object — the input signal is never mutated, even on the
 * strong-tier path.
 */
export async function applyAdxGate(
  ctx: AdxGateContext,
  coin: { id: string; symbol: string },
  priceHistory: CandleData[],
  signal: TradingSignal,
  config: AdxGateConfig
): Promise<TradingSignal | null> {
  if (config.minAdx <= 0) return { ...signal };

  const bundle = await getLatestAdxBundle(ctx, coin.id, priceHistory, config.adxPeriod);
  if (!bundle || bundle.adx < config.minAdx) {
    if (!ctx.isBacktest) {
      ctx.logger.debug(`ADX gate blocked ${coin.symbol}: adx=${bundle?.adx ?? null} < ${config.minAdx}`);
    }
    return null;
  }

  const tieredEnabled = config.adxStrongMin > config.minAdx;
  const isWeak = tieredEnabled && bundle.adx < config.adxStrongMin;

  return {
    ...signal,
    strength: isWeak ? signal.strength * config.adxWeakMultiplier : signal.strength,
    metadata: {
      ...(signal.metadata ?? {}),
      adx: bundle.adx,
      pdi: bundle.pdi,
      mdi: bundle.mdi,
      trendStrength: classifyAdxTrend(bundle.adx)
    }
  };
}
