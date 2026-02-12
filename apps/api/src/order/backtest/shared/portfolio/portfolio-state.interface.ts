/**
 * Portfolio State Interfaces
 *
 * Provides portfolio state management for backtesting including
 * initialization, updates, snapshots, and checkpoint serialization.
 */

import { Position } from '../positions';

/**
 * Portfolio state representing current holdings and cash
 */
export interface Portfolio {
  /** Cash balance in quote currency */
  cashBalance: number;
  /** Map of coinId to Position */
  positions: Map<string, Position>;
  /** Total portfolio value (cash + positions) */
  totalValue: number;
}

/**
 * Point-in-time snapshot of portfolio for charting and analysis
 */
export interface PortfolioSnapshot {
  /** Timestamp of the snapshot */
  timestamp: Date;
  /** Total portfolio value at this time */
  portfolioValue: number;
  /** Cash balance at this time */
  cashBalance: number;
  /** Holdings map: coinId -> { quantity, value, price } */
  holdings: Record<string, { quantity: number; value: number; price: number }>;
  /** Cumulative return from initial capital */
  cumulativeReturn: number;
  /** Current drawdown from peak */
  drawdown: number;
}

/**
 * Serializable position for checkpointing
 */
export interface SerializablePosition {
  coinId: string;
  quantity: number;
  averagePrice: number;
  entryDate?: string;
}

/**
 * Serializable portfolio state for checkpointing
 */
export interface SerializablePortfolio {
  cashBalance: number;
  positions: SerializablePosition[];
}

/**
 * Drawdown tracking state
 */
export interface DrawdownState {
  /** Peak portfolio value observed */
  peakValue: number;
  /** Maximum drawdown observed */
  maxDrawdown: number;
  /** Current drawdown from peak */
  currentDrawdown: number;
}

/**
 * Result of applying a trade to portfolio
 */
export interface ApplyTradeResult {
  /** Updated portfolio after trade */
  portfolio: Portfolio;
  /** Whether the trade was applied successfully */
  success: boolean;
  /** Error message if trade failed */
  error?: string;
}

/**
 * Portfolio state service interface
 */
export interface IPortfolioState {
  /**
   * Initialize a new portfolio with starting capital
   * @param initialCapital Starting cash balance
   * @returns New Portfolio instance
   */
  initialize(initialCapital: number): Portfolio;

  /**
   * Update portfolio values with current market prices
   * @param portfolio Current portfolio
   * @param prices Map of coinId to current price
   * @returns Updated portfolio with recalculated values
   */
  updateValues(portfolio: Portfolio, prices: Map<string, number>): Portfolio;

  /**
   * Apply a buy trade to the portfolio
   * @param portfolio Current portfolio
   * @param coinId Asset to buy
   * @param quantity Quantity to buy
   * @param price Execution price
   * @param fee Trading fee
   * @param currentPrices Optional map of current prices for all positions (for accurate totalValue)
   * @returns Updated portfolio
   */
  applyBuy(
    portfolio: Portfolio,
    coinId: string,
    quantity: number,
    price: number,
    fee: number,
    currentPrices?: Map<string, number>
  ): ApplyTradeResult;

  /**
   * Apply a sell trade to the portfolio
   * @param portfolio Current portfolio
   * @param coinId Asset to sell
   * @param quantity Quantity to sell
   * @param price Execution price
   * @param fee Trading fee
   * @param currentPrices Optional map of current prices for all positions (for accurate totalValue)
   * @returns Updated portfolio
   */
  applySell(
    portfolio: Portfolio,
    coinId: string,
    quantity: number,
    price: number,
    fee: number,
    currentPrices?: Map<string, number>
  ): ApplyTradeResult;

  /**
   * Create a snapshot of the current portfolio state
   * @param portfolio Current portfolio
   * @param timestamp Snapshot timestamp
   * @param prices Current prices
   * @param initialCapital Initial capital for return calculation
   * @param drawdownState Current drawdown tracking
   * @returns PortfolioSnapshot
   */
  createSnapshot(
    portfolio: Portfolio,
    timestamp: Date,
    prices: Map<string, number>,
    initialCapital: number,
    drawdownState: DrawdownState
  ): PortfolioSnapshot;

  /**
   * Update drawdown tracking with current portfolio value
   * @param currentValue Current portfolio value
   * @param currentState Current drawdown state
   * @returns Updated drawdown state
   */
  updateDrawdown(currentValue: number, currentState: DrawdownState): DrawdownState;

  /**
   * Calculate total positions value
   * @param positions Map of positions
   * @param prices Map of current prices
   * @returns Total value of all positions
   */
  calculatePositionsValue(positions: Map<string, Position>, prices: Map<string, number>): number;

  /**
   * Serialize portfolio for checkpointing
   * @param portfolio Portfolio to serialize
   * @returns Serializable portfolio object
   */
  serialize(portfolio: Portfolio): SerializablePortfolio;

  /**
   * Deserialize portfolio from checkpoint
   * @param serialized Serialized portfolio
   * @param currentPrices Current prices for value calculation
   * @returns Restored Portfolio
   */
  deserialize(serialized: SerializablePortfolio, currentPrices?: Map<string, number>): Portfolio;
}
