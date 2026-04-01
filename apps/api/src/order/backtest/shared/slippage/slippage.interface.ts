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
  /** Maximum slippage in basis points (default: 500 = 5%) */
  maxSlippageBps?: number;
  /** Max fraction of daily volume for a single order (e.g., 0.05 = 5%). Undefined = no limit. */
  participationRateLimit?: number;
  /** If raw order exceeds this fraction, reject entirely (e.g., 0.50 = 50%). Undefined = no rejection. */
  rejectParticipationRate?: number;
  /** Volatility factor (sigma) for square-root impact model (default: 0.1) */
  volatilityFactor?: number;
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
 * Fill assessment result from volume participation analysis
 */
export interface FillAssessment {
  fillable: boolean;
  fillableQuantity: number;
  fillStatus: 'FILLED' | 'PARTIAL' | 'CANCELLED';
  participationRate: number;
  reason?: string;
}

/**
 * Default slippage configuration
 * Uses fixed 5 bps (0.05%) slippage as a conservative default
 */
export const DEFAULT_SLIPPAGE_CONFIG: SlippageConfig = {
  type: SlippageModelType.FIXED,
  fixedBps: 5,
  maxSlippageBps: 500,
  volatilityFactor: 0.1
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

  /**
   * Assess whether an order can be filled given daily volume constraints
   * @param orderValue Total order value in quote currency
   * @param price Current price per unit
   * @param dailyVolume Daily trading volume in quote currency
   * @param config Slippage configuration with participation limits
   * @returns FillAssessment with fillable quantity and status
   */
  assessFillability(
    orderValue: number,
    price: number,
    dailyVolume: number | undefined,
    config?: SlippageConfig
  ): FillAssessment;
}
