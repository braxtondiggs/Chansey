/**
 * Market regime detection interfaces
 */

export enum MarketRegimeType {
  LOW_VOLATILITY = 'low_volatility', // < 25th percentile
  NORMAL = 'normal', // 25th-75th percentile
  HIGH_VOLATILITY = 'high_volatility', // 75th-90th percentile
  EXTREME = 'extreme' // > 90th percentile
}

export interface MarketRegime {
  id: string;
  asset: string; // Asset symbol (BTC, ETH, etc.)
  regime: MarketRegimeType;
  volatility: number; // Realized volatility value
  percentile: number; // Volatility percentile (0-100)
  detectedAt: Date;
  effectiveUntil?: Date | null; // End of regime period (null for current regime)
  previousRegimeId?: string | null;
  metadata?: MarketRegimeMetadata;
}

export interface MarketRegimeMetadata {
  calculationMethod: string; // e.g., "30-day-rolling-volatility"
  lookbackDays: number; // e.g., 365
  dataPoints: number;
  confidenceLevel?: number;
  [key: string]: any;
}

export interface RegimeChange {
  id: string;
  asset: string;
  fromRegime: MarketRegimeType;
  toRegime: MarketRegimeType;
  changedAt: Date;
  volatilityDelta: number; // Change in volatility
  percentileDelta: number; // Change in percentile
  impact?: RegimeChangeImpact;
}

export interface RegimeChangeImpact {
  affectedStrategies: string[]; // Array of strategy IDs
  recommendedActions: string[];
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export interface VolatilityCalculation {
  asset: string;
  period: string; // ISO date period
  volatility: number;
  percentile: number;
  regime: MarketRegimeType;
  method: 'realized' | 'implied' | 'garch';
}

/**
 * Regime percentile thresholds
 */
export const REGIME_THRESHOLDS = {
  [MarketRegimeType.LOW_VOLATILITY]: { min: 0, max: 25 },
  [MarketRegimeType.NORMAL]: { min: 25, max: 75 },
  [MarketRegimeType.HIGH_VOLATILITY]: { min: 75, max: 90 },
  [MarketRegimeType.EXTREME]: { min: 90, max: 100 }
} as const;

/**
 * Classify composite regime from volatility regime and BTC trend.
 * Pure function — shared by live and backtest paths.
 */
export function classifyCompositeRegime(
  volatilityRegime: MarketRegimeType,
  trendAboveSma: boolean
): CompositeRegimeType {
  if (!trendAboveSma) {
    return volatilityRegime === MarketRegimeType.EXTREME ? CompositeRegimeType.EXTREME : CompositeRegimeType.BEAR;
  }
  return volatilityRegime === MarketRegimeType.HIGH_VOLATILITY || volatilityRegime === MarketRegimeType.EXTREME
    ? CompositeRegimeType.NEUTRAL
    : CompositeRegimeType.BULL;
}

/**
 * Determine volatility regime from a percentile value.
 * Pure function — shared by live detection and backtest inline calculations.
 */
export function determineVolatilityRegime(percentile: number): MarketRegimeType {
  if (percentile >= REGIME_THRESHOLDS[MarketRegimeType.EXTREME].min) {
    return MarketRegimeType.EXTREME;
  } else if (percentile >= REGIME_THRESHOLDS[MarketRegimeType.HIGH_VOLATILITY].min) {
    return MarketRegimeType.HIGH_VOLATILITY;
  } else if (percentile >= REGIME_THRESHOLDS[MarketRegimeType.NORMAL].min) {
    return MarketRegimeType.NORMAL;
  } else {
    return MarketRegimeType.LOW_VOLATILITY;
  }
}

/**
 * Volatility calculation configuration
 */
export interface VolatilityConfig {
  rollingDays: number; // Default: 30
  lookbackDays: number; // Default: 365
  annualizationFactor: number; // Default: 365 for daily data
  method: 'standard' | 'exponential' | 'parkinson';
}

export const DEFAULT_VOLATILITY_CONFIG: VolatilityConfig = {
  rollingDays: 30,
  lookbackDays: 365,
  annualizationFactor: 365,
  method: 'standard'
};

/**
 * Composite regime combining volatility + BTC trend
 */
export enum CompositeRegimeType {
  BULL = 'bull', // low/normal vol + above 200 SMA
  NEUTRAL = 'neutral', // high/extreme vol + above 200 SMA
  BEAR = 'bear', // any vol + below 200 SMA
  EXTREME = 'extreme' // extreme vol + below 200 SMA
}

/**
 * Decision from the regime gate filter
 */
export interface RegimeGateDecision {
  allowed: boolean;
  compositeRegime: CompositeRegimeType;
  volatilityRegime: MarketRegimeType;
  trendAboveSma: boolean;
  signalAction: string;
  reason: string;
  timestamp: Date;
}

/**
 * Position sizing multipliers keyed by composite regime.
 */
export type RegimePositionMultipliers = Record<CompositeRegimeType, number>;

/**
 * Default regime multipliers (risk level 3 — moderate).
 */
export const DEFAULT_REGIME_MULTIPLIERS: RegimePositionMultipliers = {
  [CompositeRegimeType.BULL]: 1.0,
  [CompositeRegimeType.NEUTRAL]: 0.5,
  [CompositeRegimeType.BEAR]: 0.1,
  [CompositeRegimeType.EXTREME]: 0.05
};

/**
 * Regime position-sizing multiplier matrix indexed by risk level (1-5).
 * Higher risk levels retain more capital in adverse regimes.
 */
export const RISK_REGIME_MULTIPLIER_MATRIX: Record<number, RegimePositionMultipliers> = {
  1: {
    [CompositeRegimeType.BULL]: 1.0,
    [CompositeRegimeType.NEUTRAL]: 0.4,
    [CompositeRegimeType.BEAR]: 0.05,
    [CompositeRegimeType.EXTREME]: 0.02
  },
  2: {
    [CompositeRegimeType.BULL]: 1.0,
    [CompositeRegimeType.NEUTRAL]: 0.45,
    [CompositeRegimeType.BEAR]: 0.08,
    [CompositeRegimeType.EXTREME]: 0.03
  },
  3: {
    [CompositeRegimeType.BULL]: 1.0,
    [CompositeRegimeType.NEUTRAL]: 0.5,
    [CompositeRegimeType.BEAR]: 0.1,
    [CompositeRegimeType.EXTREME]: 0.05
  },
  4: {
    [CompositeRegimeType.BULL]: 1.0,
    [CompositeRegimeType.NEUTRAL]: 0.6,
    [CompositeRegimeType.BEAR]: 0.15,
    [CompositeRegimeType.EXTREME]: 0.08
  },
  5: {
    [CompositeRegimeType.BULL]: 1.0,
    [CompositeRegimeType.NEUTRAL]: 0.7,
    [CompositeRegimeType.BEAR]: 0.2,
    [CompositeRegimeType.EXTREME]: 0.1
  }
};

/**
 * Look up the position-sizing multiplier for a given risk level and composite regime.
 * Falls back to DEFAULT_REGIME_MULTIPLIERS for unknown risk levels,
 * and NEUTRAL (0.5) for unknown regime values.
 */
export function getRegimeMultiplier(riskLevel: number, compositeRegime: CompositeRegimeType): number {
  const multipliers = RISK_REGIME_MULTIPLIER_MATRIX[riskLevel] ?? DEFAULT_REGIME_MULTIPLIERS;
  return multipliers[compositeRegime] ?? DEFAULT_REGIME_MULTIPLIERS[CompositeRegimeType.NEUTRAL];
}

/**
 * Extended metadata that includes composite regime data.
 * Stored in the existing JSONB `metadata` column — backward-compatible.
 */
export interface CompositeRegimeMetadata extends MarketRegimeMetadata {
  compositeRegime: CompositeRegimeType;
  trendAboveSma: boolean;
  btcPrice: number;
  sma200Value: number;
}
