import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { type ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { type ExitConfig, StopLossType, TakeProfitType } from '../../order/interfaces/exit-config.interface';
import { getAdxGateRequirement, getAdxGateSchema, type IndicatorRequirement } from '../indicators';

export interface BollingerBreakoutConfig {
  period: number;
  stdDev: number;
  requireConfirmation: boolean;
  confirmationBars: number;
  minConfidence: number;
  squeezeFactor: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  adxPeriod: number;
  minAdx: number;
  adxStrongMin: number;
  adxWeakMultiplier: number;
}

/**
 * Build a fully-defaulted BollingerBreakoutConfig from a raw config record.
 */
export function getBollingerBreakoutConfigWithDefaults(config: Record<string, unknown>): BollingerBreakoutConfig {
  return {
    period: (config.period as number) ?? 20,
    stdDev: (config.stdDev as number) ?? 2,
    requireConfirmation: (config.requireConfirmation as boolean) ?? true,
    confirmationBars: (config.confirmationBars as number) ?? 3,
    minConfidence: (config.minConfidence as number) ?? 0.5,
    squeezeFactor: (config.squeezeFactor as number) ?? 1.5,
    stopLossPercent: (config.stopLossPercent as number) ?? 3.5,
    takeProfitPercent: (config.takeProfitPercent as number) ?? 6,
    adxPeriod: (config.adxPeriod as number) ?? 14,
    minAdx: (config.minAdx as number) ?? 0,
    adxStrongMin: (config.adxStrongMin as number) ?? 0,
    adxWeakMultiplier: (config.adxWeakMultiplier as number) ?? 0.5
  };
}

/**
 * Check if there is enough price history to run the strategy with the given config.
 */
export function hasEnoughDataForBollingerBreakout(
  priceHistory: CandleData[] | undefined,
  config: BollingerBreakoutConfig
): boolean {
  const minRequired = config.period + (config.requireConfirmation ? config.confirmationBars : 1);
  return !!priceHistory && priceHistory.length >= minRequired;
}

/**
 * Calculate the minimum number of data points required to run the strategy.
 */
export function getBollingerBreakoutMinDataPoints(config: Record<string, unknown>): number {
  const period = (config.period as number) ?? 20;
  const requireConfirmation = (config.requireConfirmation as boolean) ?? true;
  const confirmationBars = (config.confirmationBars as number) ?? 3;
  return period + (requireConfirmation ? confirmationBars : 1);
}

/**
 * Declare indicator requirements for precomputation during optimization.
 */
export function getBollingerBreakoutIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
  const requirements: IndicatorRequirement[] = [
    { type: 'BOLLINGER_BANDS', paramKeys: ['period', 'stdDev'], defaultParams: { period: 20, stdDev: 2 } }
  ];
  const adxRequirement = getAdxGateRequirement(config);
  if (adxRequirement) requirements.push(adxRequirement);
  return requirements;
}

/**
 * Get algorithm-specific configuration schema for the Bollinger Bands Breakout strategy.
 * @param baseSchema The result of `super.getConfigSchema()` from the base strategy
 */
export function getBollingerBreakoutConfigSchema(baseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseSchema,
    period: { type: 'number', default: 20, min: 15, max: 50, description: 'Bollinger Bands period' },
    stdDev: { type: 'number', default: 2, min: 1.5, max: 3, description: 'Standard deviation multiplier' },
    requireConfirmation: { type: 'boolean', default: true, description: 'Require multiple bars confirmation' },
    confirmationBars: { type: 'number', default: 3, min: 1, max: 5, description: 'Number of bars for confirmation' },
    minConfidence: { type: 'number', default: 0.5, min: 0, max: 1, description: 'Minimum confidence required' },
    squeezeFactor: {
      type: 'number',
      default: 1.5,
      min: 1.0,
      max: 3.0,
      description: 'Max bandwidth/avg to allow signals (lower = stricter squeeze)'
    },
    stopLossPercent: {
      type: 'number',
      default: 3.5,
      min: 1.5,
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

/**
 * Get parameter constraints for the Bollinger Bands Breakout strategy optimization.
 */
export function getBollingerBreakoutParameterConstraints(): ParameterConstraint[] {
  return [
    {
      type: 'less_than',
      param1: 'stopLossPercent',
      param2: 'takeProfitPercent',
      message: 'stopLossPercent must be less than takeProfitPercent'
    }
  ];
}

/**
 * Build the static percentage-based exit configuration for the breakout strategy.
 */
export function buildBollingerBreakoutExitConfig(config: BollingerBreakoutConfig): Partial<ExitConfig> {
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
