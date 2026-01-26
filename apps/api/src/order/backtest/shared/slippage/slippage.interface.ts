/**
 * Slippage Service Interfaces
 *
 * Provides configurable slippage simulation for backtesting.
 * Supports multiple slippage models to approximate real-world execution costs.
 */

/**
 * Type of slippage model to use
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

/**
 * Configuration for slippage calculation
 */
export interface SlippageConfig {
  /** Type of slippage model to use */
  type: SlippageModelType;
  /** Fixed slippage in basis points (for FIXED model) */
  fixedBps?: number;
  /** Base slippage in basis points (for VOLUME_BASED model) */
  baseSlippageBps?: number;
  /** Multiplier for volume impact (for VOLUME_BASED model) */
  volumeImpactFactor?: number;
  /** Maximum slippage in basis points (default: 500 = 5%) */
  maxSlippageBps?: number;
}

/**
 * Result of slippage calculation
 */
export interface SlippageResult {
  /** Slippage in basis points */
  slippageBps: number;
  /** Execution price after slippage */
  executionPrice: number;
  /** Price impact as a decimal (e.g., 0.001 = 0.1%) */
  priceImpact: number;
  /** Original price before slippage */
  originalPrice: number;
}

/**
 * Input parameters for slippage calculation
 */
export interface SlippageInput {
  /** Base price before slippage */
  price: number;
  /** Order quantity */
  quantity: number;
  /** True for buy orders, false for sell orders */
  isBuy: boolean;
  /** Optional daily volume for volume-based calculations */
  dailyVolume?: number;
}

/**
 * Default slippage configuration
 * Uses fixed 5 bps (0.05%) slippage as a conservative default
 */
export const DEFAULT_SLIPPAGE_CONFIG: SlippageConfig = {
  type: SlippageModelType.FIXED,
  fixedBps: 5,
  maxSlippageBps: 500
};

/**
 * Slippage service interface
 */
export interface ISlippageService {
  /**
   * Calculate slippage and execution price for an order
   * @param input Order details including price, quantity, and direction
   * @param config Slippage model configuration
   * @returns SlippageResult with execution price and slippage details
   */
  calculateSlippage(input: SlippageInput, config?: SlippageConfig): SlippageResult;

  /**
   * Calculate slippage in basis points without applying to price
   * @param quantity Order quantity
   * @param price Order price
   * @param config Slippage model configuration
   * @param dailyVolume Optional daily volume for volume-based calculations
   * @returns Slippage in basis points
   */
  calculateSlippageBps(quantity: number, price: number, config?: SlippageConfig, dailyVolume?: number): number;

  /**
   * Apply slippage to a price
   * @param price Base price before slippage
   * @param slippageBps Slippage in basis points
   * @param isBuy True for buy orders, false for sell orders
   * @returns Adjusted price after slippage
   */
  applySlippage(price: number, slippageBps: number, isBuy: boolean): number;

  /**
   * Build configuration from partial inputs with defaults
   * @param config Partial configuration
   * @returns Complete SlippageConfig with defaults applied
   */
  buildConfig(config?: Partial<SlippageConfig>): SlippageConfig;
}
