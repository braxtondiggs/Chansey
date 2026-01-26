/**
 * Fee Calculator Interfaces
 *
 * Provides fee calculation for backtesting with support for multiple fee structures.
 */

/**
 * Fee calculation type
 */
export enum FeeType {
  /** Single flat rate for all trades */
  FLAT = 'flat',
  /** Different rates for maker vs taker orders */
  MAKER_TAKER = 'maker_taker'
}

/**
 * Fee configuration for trade execution
 */
export interface FeeConfig {
  /** Type of fee structure */
  type: FeeType;
  /** Flat rate as decimal (e.g., 0.001 = 0.1%) - used for FLAT type */
  flatRate?: number;
  /** Maker rate as decimal - used for MAKER_TAKER type */
  makerRate?: number;
  /** Taker rate as decimal - used for MAKER_TAKER type */
  takerRate?: number;
}

/**
 * Result of fee calculation
 */
export interface FeeResult {
  /** Fee amount in quote currency */
  fee: number;
  /** Rate applied as decimal */
  rate: number;
  /** Whether this was a maker or taker order (if applicable) */
  orderType?: 'maker' | 'taker';
}

/**
 * Input parameters for fee calculation
 */
export interface FeeInput {
  /** Total trade value in quote currency */
  tradeValue: number;
  /** Whether this is a maker order (adds liquidity) */
  isMaker?: boolean;
}

/**
 * Default fee configuration
 * Uses flat 0.1% (10 bps) fee as a typical exchange rate
 */
export const DEFAULT_FEE_CONFIG: FeeConfig = {
  type: FeeType.FLAT,
  flatRate: 0.001 // 0.1%
};

/**
 * Fee calculator service interface
 */
export interface IFeeCalculator {
  /**
   * Calculate fee for a trade
   * @param input Trade details including value and order type
   * @param config Fee configuration
   * @returns FeeResult with fee amount and rate
   */
  calculateFee(input: FeeInput, config?: FeeConfig): FeeResult;

  /**
   * Get the fee rate for an order type
   * @param config Fee configuration
   * @param isMaker Whether the order is a maker order
   * @returns Fee rate as decimal
   */
  getRate(config: FeeConfig, isMaker?: boolean): number;

  /**
   * Build complete fee configuration from partial input
   * @param config Partial configuration
   * @returns Complete FeeConfig with defaults
   */
  buildConfig(config?: Partial<FeeConfig>): FeeConfig;

  /**
   * Create FeeConfig from a simple flat rate
   * @param rate Fee rate as decimal (e.g., 0.001 for 0.1%)
   * @returns FeeConfig with flat rate
   */
  fromFlatRate(rate: number): FeeConfig;
}
