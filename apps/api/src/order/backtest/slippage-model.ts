/**
 * Slippage Model Types and Functions
 *
 * Provides configurable slippage simulation for backtesting.
 * Supports multiple slippage models to approximate real-world execution costs.
 */

export enum SlippageModelType {
  /** No slippage applied (ideal execution) */
  NONE = 'none',
  /** Fixed slippage in basis points */
  FIXED = 'fixed',
  /** Slippage increases with order size relative to volume */
  VOLUME_BASED = 'volume-based',
  /** Use historical slippage data (placeholder for future implementation) */
  HISTORICAL = 'historical'
}

export interface SlippageModelConfig {
  /** Type of slippage model to use */
  type: SlippageModelType;
  /** Fixed slippage in basis points (for FIXED model) */
  fixedBps?: number;
  /** Base slippage in basis points (for VOLUME_BASED model) */
  baseSlippageBps?: number;
  /** Multiplier for volume impact (for VOLUME_BASED model) */
  volumeImpactFactor?: number;
}

/**
 * Default slippage configuration
 * Uses fixed 5 bps (0.05%) slippage as a conservative default
 */
export const DEFAULT_SLIPPAGE_CONFIG: SlippageModelConfig = {
  type: SlippageModelType.FIXED,
  fixedBps: 5
};

/**
 * Calculate simulated slippage based on model configuration
 *
 * @param config - Slippage model configuration
 * @param quantity - Order quantity
 * @param price - Order price
 * @param dailyVolume - Optional daily volume for volume-based calculations
 * @returns Slippage in basis points
 */
export function calculateSimulatedSlippage(
  config: SlippageModelConfig,
  quantity: number,
  price: number,
  dailyVolume?: number
): number {
  switch (config.type) {
    case SlippageModelType.NONE:
      return 0;

    case SlippageModelType.FIXED:
      return config.fixedBps ?? 5;

    case SlippageModelType.VOLUME_BASED: {
      // Slippage increases with order size relative to daily volume
      const orderValue = quantity * price;
      const volumeRatio = dailyVolume && dailyVolume > 0 ? orderValue / dailyVolume : 0.001;
      const baseSlippage = config.baseSlippageBps ?? 5;
      const volumeImpact = config.volumeImpactFactor ?? 100;
      // Cap at reasonable maximum (500 bps = 5%)
      return Math.min(baseSlippage + volumeRatio * volumeImpact, 500);
    }

    case SlippageModelType.HISTORICAL:
      // Placeholder for historical slippage data integration
      // Would use actual historical slippage from similar orders
      return config.fixedBps ?? 10;

    default:
      return 5;
  }
}

/**
 * Apply slippage to execution price
 *
 * @param price - Base price before slippage
 * @param slippageBps - Slippage in basis points
 * @param isBuy - True for buy orders, false for sell orders
 * @returns Adjusted price after slippage
 */
export function applySlippage(price: number, slippageBps: number, isBuy: boolean): number {
  const slippageFactor = slippageBps / 10000;
  // Buy orders pay more (price increases), sell orders receive less (price decreases)
  return isBuy ? price * (1 + slippageFactor) : price * (1 - slippageFactor);
}

/**
 * Build SlippageModelConfig from DTO parameters
 *
 * @param slippageModel - Type of slippage model
 * @param slippageFixedBps - Fixed slippage value
 * @param slippageBaseBps - Base slippage for volume-based model
 * @param slippageVolumeImpactFactor - Volume impact factor
 * @returns Complete SlippageModelConfig
 */
export function buildSlippageConfig(
  slippageModel?: SlippageModelType,
  slippageFixedBps?: number,
  slippageBaseBps?: number,
  slippageVolumeImpactFactor?: number
): SlippageModelConfig {
  return {
    type: slippageModel ?? SlippageModelType.FIXED,
    fixedBps: slippageFixedBps ?? 5,
    baseSlippageBps: slippageBaseBps ?? 5,
    volumeImpactFactor: slippageVolumeImpactFactor ?? 100
  };
}
