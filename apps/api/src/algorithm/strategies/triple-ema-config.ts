import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { type ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { type ExitConfig, StopLossType, TakeProfitType } from '../../order/interfaces/exit-config.interface';
import { getAdxGateRequirement, getAdxGateSchema, type IndicatorRequirement } from '../indicators';

export interface TripleEMAConfig {
  fastPeriod: number;
  mediumPeriod: number;
  slowPeriod: number;
  requireFullAlignment: boolean;
  signalOnPartialCross: boolean;
  minConfidence: number;
  minSpread: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  adxPeriod: number;
  minAdx: number;
  adxStrongMin: number;
  adxWeakMultiplier: number;
}

/**
 * Build a fully-defaulted TripleEMAConfig from a raw config record.
 */
export function getTripleEMAConfigWithDefaults(config: Record<string, unknown>): TripleEMAConfig {
  return {
    fastPeriod: (config.fastPeriod as number) ?? 8,
    mediumPeriod: (config.mediumPeriod as number) ?? 21,
    slowPeriod: (config.slowPeriod as number) ?? 55,
    requireFullAlignment: (config.requireFullAlignment as boolean) ?? false,
    signalOnPartialCross: (config.signalOnPartialCross as boolean) ?? true,
    minConfidence: (config.minConfidence as number) ?? 0.3,
    minSpread: (config.minSpread as number) ?? 0.001,
    stopLossPercent: (config.stopLossPercent as number) ?? 3.5,
    takeProfitPercent: (config.takeProfitPercent as number) ?? 6,
    adxPeriod: (config.adxPeriod as number) ?? 14,
    minAdx: (config.minAdx as number) ?? 0,
    adxStrongMin: (config.adxStrongMin as number) ?? 0,
    adxWeakMultiplier: (config.adxWeakMultiplier as number) ?? 0.5
  };
}

/**
 * Build the ExitConfig for Triple EMA strategy.
 */
export function buildTripleEMAExitConfig(config: TripleEMAConfig): Partial<ExitConfig> {
  return {
    enableStopLoss: true,
    stopLossType: StopLossType.PERCENTAGE,
    stopLossValue: config.stopLossPercent,
    enableTakeProfit: true,
    takeProfitType: TakeProfitType.PERCENTAGE,
    takeProfitValue: config.takeProfitPercent,
    enableTrailingStop: false,
    useOco: true
  };
}

/**
 * Check if there is enough price history to run the strategy with the given config.
 */
export function hasEnoughTripleEMAData(priceHistory: CandleData[] | undefined, config: TripleEMAConfig): boolean {
  return !!priceHistory && priceHistory.length >= config.slowPeriod + 5;
}

/**
 * Calculate the minimum number of data points required to run the strategy.
 */
export function getTripleEMAMinDataPoints(config: Record<string, unknown>): number {
  const slowPeriod = (config.slowPeriod as number) ?? 55;
  return slowPeriod + 5;
}

/**
 * Declare indicator requirements for precomputation during optimization.
 */
export function getTripleEMAIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
  const requirements: IndicatorRequirement[] = [
    { type: 'EMA', paramKeys: ['fastPeriod'], defaultParams: { fastPeriod: 8 } },
    { type: 'EMA', paramKeys: ['mediumPeriod'], defaultParams: { mediumPeriod: 21 } },
    { type: 'EMA', paramKeys: ['slowPeriod'], defaultParams: { slowPeriod: 55 } }
  ];
  const adxRequirement = getAdxGateRequirement(config);
  if (adxRequirement) requirements.push(adxRequirement);
  return requirements;
}

/**
 * Parameter constraints for grid search optimization.
 */
export function getTripleEMAParameterConstraints(): ParameterConstraint[] {
  return [
    {
      type: 'less_than',
      param1: 'fastPeriod',
      param2: 'mediumPeriod',
      message: 'fastPeriod must be less than mediumPeriod'
    },
    {
      type: 'less_than',
      param1: 'mediumPeriod',
      param2: 'slowPeriod',
      message: 'mediumPeriod must be less than slowPeriod'
    },
    {
      type: 'less_than',
      param1: 'stopLossPercent',
      param2: 'takeProfitPercent',
      message: 'stopLossPercent must be less than takeProfitPercent'
    }
  ];
}

/**
 * Get algorithm-specific configuration schema for the Triple EMA strategy.
 * @param baseSchema The result of `super.getConfigSchema()` from the base strategy
 */
export function getTripleEMAConfigSchema(baseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseSchema,
    fastPeriod: { type: 'number', default: 8, min: 3, max: 15, description: 'Fast EMA period' },
    mediumPeriod: { type: 'number', default: 21, min: 10, max: 30, description: 'Medium EMA period' },
    slowPeriod: { type: 'number', default: 55, min: 30, max: 100, description: 'Slow EMA period' },
    requireFullAlignment: { type: 'boolean', default: false, description: 'Require all 3 EMAs aligned for signal' },
    signalOnPartialCross: { type: 'boolean', default: true, description: 'Signal on fast/medium crossover' },
    minConfidence: { type: 'number', default: 0.3, min: 0, max: 1, description: 'Minimum confidence required' },
    minSpread: {
      type: 'number',
      default: 0.001,
      min: 0,
      max: 0.05,
      description: 'Minimum EMA spread to generate signal. Filters noise crosses.'
    },
    stopLossPercent: {
      type: 'number',
      default: 3.5,
      min: 1,
      max: 15,
      description: 'Stop-loss distance as percentage of entry price'
    },
    takeProfitPercent: {
      type: 'number',
      default: 6,
      min: 2,
      max: 20,
      description: 'Take-profit distance as percentage of entry price'
    },
    ...getAdxGateSchema()
  };
}
