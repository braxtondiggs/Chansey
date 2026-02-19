/**
 * Exit Configuration Interfaces
 *
 * Defines the types and interfaces for automated stop-loss and take-profit exit rules.
 * Used by PositionManagementService to calculate and place exit orders.
 */

/**
 * Stop loss calculation method
 */
export enum StopLossType {
  /** Absolute price level */
  FIXED = 'fixed',
  /** Percentage below/above entry price */
  PERCENTAGE = 'percentage',
  /** ATR-based dynamic distance */
  ATR = 'atr'
}

/**
 * Take profit calculation method
 */
export enum TakeProfitType {
  /** Absolute price level */
  FIXED = 'fixed',
  /** Percentage above/below entry price */
  PERCENTAGE = 'percentage',
  /** Multiple of stop loss distance (risk:reward ratio) */
  RISK_REWARD = 'risk_reward'
}

/**
 * Trailing stop activation trigger
 */
export enum TrailingActivationType {
  /** Start trailing immediately from entry */
  IMMEDIATE = 'immediate',
  /** Activate at specific price level */
  PRICE = 'price',
  /** Activate at percentage gain from entry */
  PERCENTAGE = 'percentage'
}

/**
 * Trailing stop distance calculation method
 */
export enum TrailingType {
  /** Fixed amount in quote currency */
  AMOUNT = 'amount',
  /** Percentage from high water mark */
  PERCENTAGE = 'percentage',
  /** ATR-based dynamic distance */
  ATR = 'atr'
}

/**
 * Exit configuration for a position
 */
export interface ExitConfig {
  // ─── Stop Loss Configuration ───────────────────────────────────────────────
  /** Enable automatic stop loss placement */
  enableStopLoss: boolean;
  /** Method to calculate stop loss price */
  stopLossType: StopLossType;
  /**
   * Stop loss value interpretation depends on type:
   * - FIXED: Absolute price level
   * - PERCENTAGE: Percentage value (e.g., 5 = 5% below entry for longs)
   * - ATR: ATR multiplier (e.g., 2 = 2x ATR below entry for longs)
   */
  stopLossValue: number;
  /** Offset from stop price for stop-limit orders (optional) */
  stopLossLimitOffset?: number;

  // ─── Take Profit Configuration ─────────────────────────────────────────────
  /** Enable automatic take profit placement */
  enableTakeProfit: boolean;
  /** Method to calculate take profit price */
  takeProfitType: TakeProfitType;
  /**
   * Take profit value interpretation depends on type:
   * - FIXED: Absolute price level
   * - PERCENTAGE: Percentage value (e.g., 10 = 10% above entry for longs)
   * - RISK_REWARD: Multiple of stop loss distance (e.g., 2 = 2:1 R:R)
   */
  takeProfitValue: number;

  // ─── ATR-Specific Configuration ────────────────────────────────────────────
  /** ATR calculation period (default: 14) */
  atrPeriod?: number;
  /** ATR multiplier for stop loss (default: 2.0) */
  atrMultiplier?: number;

  // ─── Trailing Stop Configuration ───────────────────────────────────────────
  /** Enable trailing stop */
  enableTrailingStop: boolean;
  /** Method to calculate trailing distance */
  trailingType: TrailingType;
  /**
   * Trailing value interpretation depends on type:
   * - AMOUNT: Fixed amount in quote currency
   * - PERCENTAGE: Percentage value (e.g., 2 = 2% below high water mark)
   * - ATR: ATR multiplier
   */
  trailingValue: number;
  /** How the trailing stop activates */
  trailingActivation: TrailingActivationType;
  /**
   * Activation value interpretation depends on trailingActivation:
   * - IMMEDIATE: Not used
   * - PRICE: Absolute price level to activate trailing
   * - PERCENTAGE: Percentage gain from entry to activate (e.g., 1 = 1% profit)
   */
  trailingActivationValue?: number;

  // ─── OCO Configuration ─────────────────────────────────────────────────────
  /** Link stop loss and take profit as OCO (one-cancels-other) */
  useOco: boolean;
}

/**
 * Default exit configuration values
 */
export const DEFAULT_EXIT_CONFIG: ExitConfig = {
  // Stop Loss defaults
  enableStopLoss: false,
  stopLossType: StopLossType.PERCENTAGE,
  stopLossValue: 2.0, // 2% default stop loss

  // Take Profit defaults
  enableTakeProfit: false,
  takeProfitType: TakeProfitType.RISK_REWARD,
  takeProfitValue: 2.0, // 2:1 risk:reward default

  // ATR defaults
  atrPeriod: 14,
  atrMultiplier: 2.0,

  // Trailing Stop defaults
  enableTrailingStop: false,
  trailingType: TrailingType.PERCENTAGE,
  trailingValue: 1.0, // 1% trailing distance
  trailingActivation: TrailingActivationType.IMMEDIATE,

  // OCO defaults
  useOco: true
};

/**
 * Calculated exit prices from entry and configuration
 */
export interface CalculatedExitPrices {
  /** Entry price used for calculations */
  entryPrice: number;
  /** Calculated stop loss price (undefined if disabled) */
  stopLossPrice?: number;
  /** Calculated take profit price (undefined if disabled) */
  takeProfitPrice?: number;
  /** Initial trailing stop price (undefined if disabled) */
  trailingStopPrice?: number;
  /** Price at which trailing stop activates (undefined if immediate) */
  trailingActivationPrice?: number;
}

/**
 * Position exit order tracking status
 */
export enum PositionExitStatus {
  /** Exit orders are active and monitoring */
  ACTIVE = 'active',
  /** Stop loss was triggered */
  STOP_LOSS_TRIGGERED = 'sl_triggered',
  /** Take profit was triggered */
  TAKE_PROFIT_TRIGGERED = 'tp_triggered',
  /** Trailing stop was triggered */
  TRAILING_TRIGGERED = 'trailing_triggered',
  /** Exit orders were manually cancelled */
  CANCELLED = 'cancelled',
  /** Exit orders expired (e.g., position closed manually) */
  EXPIRED = 'expired',
  /** Exit order update failed (position may be unprotected) */
  ERROR = 'error'
}

/**
 * Parameters for placing exit orders
 */
export interface PlaceExitOrderParams {
  userId: string;
  exchangeKeyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  orderType: 'stop_loss' | 'take_profit' | 'trailing_stop';
  stopPrice?: number;
  trailingAmount?: number;
  trailingType?: TrailingType;
}

/**
 * Result from attaching exit orders to an entry
 */
export interface AttachExitOrdersResult {
  /** ID of the position exit tracking record */
  positionExitId: string;
  /** Stop loss order ID (if placed) */
  stopLossOrderId?: string;
  /** Take profit order ID (if placed) */
  takeProfitOrderId?: string;
  /** Trailing stop order ID (if placed) */
  trailingStopOrderId?: string;
  /** Calculated exit prices */
  calculatedPrices: CalculatedExitPrices;
  /** Whether OCO linking was successful */
  ocoLinked: boolean;
  /** Any warnings during exit order placement */
  warnings?: string[];
}

/**
 * Validation limits for exit prices (sanity checks)
 * Prevents price manipulation and unreasonable exit levels
 */
export interface ExitPriceValidationLimits {
  /** Max stop loss distance from entry as percentage (default: 50%) */
  maxStopLossPercentage: number;
  /** Min stop loss distance from entry as percentage (default: 0.1%) */
  minStopLossPercentage: number;
  /** Max take profit distance from entry as percentage (default: 500%) */
  maxTakeProfitPercentage: number;
  /** Min take profit distance from entry as percentage (default: 0.1%) */
  minTakeProfitPercentage: number;
  /** Max trailing stop distance from entry as percentage (default: 50%) */
  maxTrailingStopPercentage: number;
  /** Min trailing stop distance from entry as percentage (default: 0.1%) */
  minTrailingStopPercentage: number;
}

/**
 * Default validation limits
 */
export const DEFAULT_EXIT_PRICE_VALIDATION_LIMITS: ExitPriceValidationLimits = {
  maxStopLossPercentage: 50, // Reject stop loss >50% away from entry
  minStopLossPercentage: 0.1, // Reject stop loss <0.1% away (likely error)
  maxTakeProfitPercentage: 500, // Reject take profit >500% away
  minTakeProfitPercentage: 0.1, // Reject take profit <0.1% away
  maxTrailingStopPercentage: 50, // Reject trailing stop >50% away
  minTrailingStopPercentage: 0.1 // Reject trailing stop <0.1% away
};

/**
 * Individual validation error for exit price
 */
export interface ExitPriceValidationError {
  /** Type of exit (stopLoss, takeProfit, trailingStop) */
  exitType: 'stopLoss' | 'takeProfit' | 'trailingStop';
  /** Error code for programmatic handling */
  code: ExitPriceValidationErrorCode;
  /** Human-readable error message */
  message: string;
  /** Calculated price that failed validation */
  calculatedPrice: number;
  /** Entry price used for reference */
  entryPrice: number;
  /** Distance percentage from entry */
  distancePercentage: number;
}

/**
 * Error codes for exit price validation
 */
export enum ExitPriceValidationErrorCode {
  /** Price is on wrong side of entry */
  WRONG_SIDE = 'wrong_side',
  /** Distance exceeds maximum allowed */
  EXCEEDS_MAX_DISTANCE = 'exceeds_max_distance',
  /** Distance is below minimum allowed */
  BELOW_MIN_DISTANCE = 'below_min_distance',
  /** Price is negative or zero */
  INVALID_PRICE = 'invalid_price'
}

/**
 * Result of exit price validation
 */
export interface ExitPriceValidationResult {
  /** Whether all prices passed validation */
  isValid: boolean;
  /** List of validation errors (empty if valid) */
  errors: ExitPriceValidationError[];
}

/**
 * Quantity validation result for exit orders
 */
export interface QuantityValidationResult {
  /** Whether quantity is valid for exchange */
  isValid: boolean;
  /** Original quantity requested */
  originalQuantity: number;
  /** Adjusted quantity (aligned to step size) */
  adjustedQuantity: number;
  /** Minimum allowed quantity */
  minQuantity: number;
  /** Minimum notional value required */
  minNotional: number;
  /** Actual notional value */
  actualNotional: number;
  /** Error message if invalid */
  error?: string;
}

/**
 * Exchange market limits for quantity validation
 */
export interface ExchangeMarketLimits {
  /** Minimum order quantity */
  minAmount: number;
  /** Maximum order quantity */
  maxAmount: number;
  /** Quantity step size (precision) */
  amountStep: number;
  /** Minimum order value (notional) in quote currency */
  minCost: number;
  /** Price precision */
  pricePrecision: number;
  /** Amount precision (decimal places) */
  amountPrecision: number;
}
