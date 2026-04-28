import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { type ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { getAdxGateRequirement, getAdxGateSchema, type IndicatorRequirement } from '../indicators';

export interface RSIDivergenceConfig {
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
  adxPeriod: number;
  minAdx: number;
  adxStrongMin: number;
  adxWeakMultiplier: number;
  lowVolRelaxation: boolean;
}

export const MIN_RSI_DIVERGENCE = 2;

/**
 * Build a fully-defaulted RSIDivergenceConfig from a raw config record.
 */
export function getRSIDivergenceConfigWithDefaults(config: Record<string, unknown>): RSIDivergenceConfig {
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
    takeProfitMax: (config.takeProfitMax as number) ?? 20,
    adxPeriod: (config.adxPeriod as number) ?? 14,
    minAdx: (config.minAdx as number) ?? 0,
    adxStrongMin: (config.adxStrongMin as number) ?? 0,
    adxWeakMultiplier: (config.adxWeakMultiplier as number) ?? 0.5,
    lowVolRelaxation: (config.lowVolRelaxation as boolean) ?? true
  };
}

/**
 * Apply low-volatility runtime adjustments. When BTC realized vol sits in the
 * bottom percentile band, divergences appear as smaller magnitudes over longer
 * windows — relax the detection bounds so we still catch them.
 */
export function applyLowVolRelaxation(config: RSIDivergenceConfig): RSIDivergenceConfig {
  return {
    ...config,
    lookbackPeriod: Math.min(60, Math.round(config.lookbackPeriod * 1.5)),
    minDivergencePercent: Math.max(0.5, config.minDivergencePercent * 0.6),
    pivotTolerance: Math.min(0.8, config.pivotTolerance * 1.3)
  };
}

/**
 * Check if there is enough price history to run the strategy with the given config.
 */
export function hasEnoughDataForRSIDivergence(
  priceHistory: CandleData[] | undefined,
  config: RSIDivergenceConfig
): boolean {
  const minRequired = Math.max(config.rsiPeriod, config.emaPeriod) + config.lookbackPeriod + config.pivotStrength * 2;
  return !!priceHistory && priceHistory.length >= minRequired;
}

/**
 * Calculate the minimum number of data points required to run the strategy.
 */
export function getRSIDivergenceMinDataPoints(config: Record<string, unknown>): number {
  const rsiPeriod = (config.rsiPeriod as number) ?? 14;
  const emaPeriod = (config.emaPeriod as number) ?? 50;
  const lookbackPeriod = (config.lookbackPeriod as number) ?? 30;
  const pivotStrength = (config.pivotStrength as number) ?? 3;
  return Math.max(rsiPeriod, emaPeriod) + lookbackPeriod + pivotStrength * 2;
}

/**
 * Declare indicator requirements for precomputation during optimization.
 */
export function getRSIDivergenceIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
  const requirements: IndicatorRequirement[] = [
    { type: 'RSI', paramKeys: ['rsiPeriod'], defaultParams: { rsiPeriod: 14 } },
    { type: 'EMA', paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 50 } },
    { type: 'ATR', paramKeys: ['atrPeriod'], defaultParams: { atrPeriod: 14 } }
  ];
  const adxRequirement = getAdxGateRequirement(config);
  if (adxRequirement) requirements.push(adxRequirement);
  return requirements;
}

/**
 * Get algorithm-specific configuration schema for the RSI Divergence strategy.
 * @param baseSchema The result of `super.getConfigSchema()` from the base strategy
 */
export function getRSIDivergenceConfigSchema(baseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseSchema,
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
      max: 8,
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
    },
    ...getAdxGateSchema(),
    lowVolRelaxation: {
      type: 'boolean',
      default: true,
      description: 'Relax pivot/divergence bounds during LOW_VOLATILITY regime'
    }
  };
}

/**
 * Get parameter constraints for the RSI Divergence strategy optimization.
 * Prevent the optimizer from picking inverted bounds (e.g. takeProfitMin=10, takeProfitMax=6)
 * which would silently collapse the ATR-scaled clamp to a constant and disable the dynamic exit.
 */
export function getRSIDivergenceParameterConstraints(): ParameterConstraint[] {
  return [
    { type: 'less_than', param1: 'stopLossMin', param2: 'stopLossMax' },
    { type: 'less_than', param1: 'takeProfitMin', param2: 'takeProfitMax' }
  ];
}
