/**
 * Position Manager Interfaces
 *
 * Provides position lifecycle management for backtesting.
 */

/**
 * Position state for a single asset
 */
export interface Position {
  /** Unique identifier for the coin/asset */
  coinId: string;
  /** Quantity held */
  quantity: number;
  /** Volume-weighted average price of the position */
  averagePrice: number;
  /** Current market value of the position */
  totalValue: number;
  /** Timestamp when the position was first opened (used for hold-time calculation) */
  entryDate?: Date;
}

/**
 * Result of a position action
 */
export interface PositionActionResult {
  /** Whether the action was successful */
  success: boolean;
  /** The position after the action (if successful) */
  position?: Position;
  /** Realized P&L (for partial/full closes) */
  realizedPnL?: number;
  /** Realized P&L as percentage of cost basis */
  realizedPnLPercent?: number;
  /** Cost basis of the closed portion */
  costBasis?: number;
  /** Actual quantity affected */
  quantity: number;
  /** Execution price */
  price: number;
  /** Total value of the action */
  totalValue: number;
  /** Error message if action failed */
  error?: string;
}

/**
 * Position sizing configuration
 */
export interface PositionSizingConfig {
  /** Maximum allocation per position as percentage of portfolio (0-1) */
  maxAllocation?: number;
  /** Minimum allocation per position as percentage of portfolio (0-1) */
  minAllocation?: number;
  /** Maximum number of open positions */
  maxPositions?: number;
  /** Maximum position size relative to daily volume (0-1) */
  maxVolumeParticipation?: number;
}

/**
 * Parameters for opening/increasing a position
 */
export interface OpenPositionInput {
  /** Coin/asset identifier */
  coinId: string;
  /** Execution price */
  price: number;
  /** Quantity to add (mutually exclusive with percentage/confidence) */
  quantity?: number;
  /** Percentage of available capital to use (0-1) */
  percentage?: number;
  /** Confidence level for position sizing (0-1) */
  confidence?: number;
  /** Available capital for the position */
  availableCapital: number;
  /** Total portfolio value for allocation calculations */
  portfolioValue: number;
}

/**
 * Parameters for closing/reducing a position
 */
export interface ClosePositionInput {
  /** Coin/asset identifier */
  coinId: string;
  /** Execution price */
  price: number;
  /** Quantity to sell (mutually exclusive with percentage/confidence) */
  quantity?: number;
  /** Percentage of position to sell (0-1) */
  percentage?: number;
  /** Confidence level for exit sizing (0-1) */
  confidence?: number;
}

/**
 * Position validation error
 */
export interface PositionValidationError {
  /** Error code */
  code:
    | 'ZERO_QUANTITY'
    | 'NEGATIVE_QUANTITY'
    | 'INSUFFICIENT_CAPITAL'
    | 'NO_POSITION'
    | 'MAX_POSITIONS'
    | 'INVALID_PRICE';
  /** Human-readable error message */
  message: string;
}

/**
 * Default position sizing configuration
 */
export const DEFAULT_POSITION_CONFIG: PositionSizingConfig = {
  maxAllocation: 0.12, // 12% max per position
  minAllocation: 0.03, // 3% min per position
  maxPositions: 20,
  maxVolumeParticipation: 0.01 // 1% of daily volume
};

/**
 * Confidence-based exit sizing constants
 * When exiting based on confidence, the exit percentage scales from MIN to MAX
 * Higher confidence = sell more of the position
 */
export const CONFIDENCE_EXIT_MIN_PERCENT = 0.25; // 25% minimum exit at 0 confidence
export const CONFIDENCE_EXIT_MAX_PERCENT = 1.0; // 100% maximum exit at 1.0 confidence

/**
 * Position manager service interface
 */
export interface IPositionManager {
  /**
   * Open or increase a position
   * @param existingPosition Current position (if any)
   * @param input Open position parameters
   * @param config Position sizing configuration
   * @returns PositionActionResult with updated position
   */
  openPosition(
    existingPosition: Position | undefined,
    input: OpenPositionInput,
    config?: PositionSizingConfig
  ): PositionActionResult;

  /**
   * Close or reduce a position
   * @param position Current position
   * @param input Close position parameters
   * @param config Position sizing configuration
   * @returns PositionActionResult with P&L details
   */
  closePosition(position: Position, input: ClosePositionInput, config?: PositionSizingConfig): PositionActionResult;

  /**
   * Calculate position size based on confidence and configuration
   * @param portfolioValue Total portfolio value
   * @param confidence Signal confidence (0-1)
   * @param price Current price
   * @param config Position sizing configuration
   * @returns Quantity to trade
   */
  calculatePositionSize(
    portfolioValue: number,
    confidence: number,
    price: number,
    config?: PositionSizingConfig
  ): number;

  /**
   * Validate a position action before execution
   * @param action 'open' or 'close'
   * @param existingPosition Current position (if any)
   * @param input Position parameters
   * @param openPositionsCount Number of currently open positions
   * @param config Position sizing configuration
   * @returns Validation error or undefined if valid
   */
  validatePosition(
    action: 'open' | 'close',
    existingPosition: Position | undefined,
    input: OpenPositionInput | ClosePositionInput,
    openPositionsCount: number,
    config?: PositionSizingConfig
  ): PositionValidationError | undefined;

  /**
   * Update position value with current market price
   * @param position Position to update
   * @param currentPrice Current market price
   * @returns Updated position
   */
  updatePositionValue(position: Position, currentPrice: number): Position;
}
