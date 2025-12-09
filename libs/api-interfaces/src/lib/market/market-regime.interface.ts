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
