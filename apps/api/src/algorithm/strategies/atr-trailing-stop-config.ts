import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import {
  type ExitConfig,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../../order/interfaces/exit-config.interface';
import { getAdxGateRequirement, getAdxGateSchema, type IndicatorRequirement } from '../indicators';

export type Direction = 'long' | 'short';

export interface ATRTrailingStopConfig {
  atrPeriod: number;
  atrMultiplier: number;
  tradeDirection: 'long' | 'short' | 'both';
  useHighLow: boolean;
  minConfidence: number;
  stopCooldownBars: number;
  adxPeriod: number;
  minAdx: number;
  adxStrongMin: number;
  adxWeakMultiplier: number;
}

/**
 * Build a fully-defaulted ATRTrailingStopConfig from a raw config record.
 */
export function getATRTrailingStopConfigWithDefaults(config: Record<string, unknown>): ATRTrailingStopConfig {
  return {
    atrPeriod: Math.max(8, Math.min(25, (config.atrPeriod as number) ?? 20)),
    atrMultiplier: Math.max(2.0, Math.min(8, (config.atrMultiplier as number) ?? 4.5)),
    tradeDirection: (config.tradeDirection as 'long' | 'short' | 'both') ?? 'long',
    useHighLow: (config.useHighLow as boolean) ?? true,
    minConfidence: (config.minConfidence as number) ?? 0.4,
    stopCooldownBars: Math.max(0, Math.min(10, (config.stopCooldownBars as number) ?? 3)),
    adxPeriod: (config.adxPeriod as number) ?? 14,
    minAdx: (config.minAdx as number) ?? 0,
    adxStrongMin: (config.adxStrongMin as number) ?? 0,
    adxWeakMultiplier: (config.adxWeakMultiplier as number) ?? 0.5
  };
}

/**
 * Build the ExitConfig for ATR trailing stop strategy.
 */
export function buildATRTrailingStopExitConfig(config: ATRTrailingStopConfig): Partial<ExitConfig> {
  return {
    enableStopLoss: true,
    stopLossType: StopLossType.ATR,
    stopLossValue: config.atrMultiplier,
    enableTakeProfit: true,
    takeProfitType: TakeProfitType.RISK_REWARD,
    takeProfitValue: 2, // 2:1 risk-reward
    atrPeriod: config.atrPeriod,
    atrMultiplier: config.atrMultiplier,
    enableTrailingStop: true,
    trailingType: TrailingType.ATR,
    trailingValue: config.atrMultiplier,
    trailingActivation: TrailingActivationType.PERCENTAGE,
    trailingActivationValue: 1, // Activate at 1% profit
    useOco: true
  };
}

/**
 * Check if there is enough price history to run the strategy with the given config.
 */
export function hasEnoughATRTrailingStopData(
  priceHistory: CandleData[] | undefined,
  config: ATRTrailingStopConfig
): boolean {
  return !!priceHistory && priceHistory.length >= config.atrPeriod + 5;
}

/**
 * Calculate the minimum number of data points required to run the strategy.
 */
export function getATRTrailingStopMinDataPoints(config: Record<string, unknown>): number {
  const atrPeriod = (config.atrPeriod as number) ?? 20;
  return atrPeriod + 5;
}

/**
 * Declare indicator requirements for precomputation during optimization.
 */
export function getATRTrailingStopIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
  const requirements: IndicatorRequirement[] = [
    { type: 'ATR', paramKeys: ['atrPeriod'], defaultParams: { atrPeriod: 20 } }
  ];
  const adxRequirement = getAdxGateRequirement(config);
  if (adxRequirement) requirements.push(adxRequirement);
  return requirements;
}

/**
 * Get algorithm-specific configuration schema for the ATR Trailing Stop strategy.
 * @param baseSchema The result of `super.getConfigSchema()` from the base strategy
 */
export function getATRTrailingStopConfigSchema(baseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseSchema,
    atrPeriod: { type: 'number', default: 20, min: 8, max: 25, description: 'ATR calculation period' },
    atrMultiplier: {
      type: 'number',
      default: 4.5,
      min: 2.0,
      max: 8,
      description: 'ATR multiplier for stop distance'
    },
    tradeDirection: {
      type: 'string',
      enum: ['long', 'short', 'both'],
      default: 'long',
      description: 'Which direction to generate stops for'
    },
    useHighLow: { type: 'boolean', default: true, description: 'Use high/low vs close for calculations' },
    minConfidence: { type: 'number', default: 0.4, min: 0, max: 1, description: 'Minimum confidence required' },
    stopCooldownBars: {
      type: 'number',
      default: 3,
      min: 0,
      max: 10,
      description: 'Bars to suppress entry signals after a stop loss fires (prevents rapid re-entry churn)'
    },
    ...getAdxGateSchema()
  };
}
