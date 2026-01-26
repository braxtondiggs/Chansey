import { Injectable } from '@nestjs/common';

import {
  ApplyTradeResult,
  DrawdownState,
  IPortfolioState,
  Portfolio,
  PortfolioSnapshot,
  SerializablePortfolio
} from './portfolio-state.interface';

import { Position } from '../positions';

/**
 * Portfolio State Service
 *
 * Manages portfolio state throughout backtest execution including:
 * - Initialization with starting capital
 * - Value updates with market prices
 * - Trade application (buy/sell)
 * - Snapshot creation for charting
 * - Checkpoint serialization/deserialization
 *
 * @example
 * ```typescript
 * // Initialize portfolio
 * const portfolio = portfolioState.initialize(10000);
 *
 * // Apply a buy trade
 * const result = portfolioState.applyBuy(portfolio, 'bitcoin', 0.1, 50000, 5);
 *
 * // Update values with current prices
 * const updated = portfolioState.updateValues(result.portfolio, priceMap);
 *
 * // Create snapshot for charting
 * const snapshot = portfolioState.createSnapshot(updated, new Date(), priceMap, 10000, drawdownState);
 * ```
 */
@Injectable()
export class PortfolioStateService implements IPortfolioState {
  /**
   * Initialize a new portfolio with starting capital
   */
  initialize(initialCapital: number): Portfolio {
    return {
      cashBalance: initialCapital,
      positions: new Map<string, Position>(),
      totalValue: initialCapital
    };
  }

  /**
   * Update portfolio values with current market prices
   * Creates a new portfolio with updated position values (immutable)
   */
  updateValues(portfolio: Portfolio, prices: Map<string, number>): Portfolio {
    let totalValue = portfolio.cashBalance;
    const newPositions = new Map<string, Position>();

    for (const [coinId, position] of portfolio.positions) {
      const currentPrice = prices.get(coinId);
      const newTotalValue = currentPrice !== undefined ? position.quantity * currentPrice : position.totalValue;

      // Create new position object (immutable)
      newPositions.set(coinId, {
        ...position,
        totalValue: newTotalValue
      });

      totalValue += newTotalValue;
    }

    return {
      cashBalance: portfolio.cashBalance,
      positions: newPositions,
      totalValue
    };
  }

  /**
   * Apply a buy trade to the portfolio
   * Deducts cost + fee from cash, adds or increases position
   *
   * @param portfolio Current portfolio state
   * @param coinId The coin to buy
   * @param quantity Amount to buy
   * @param price Execution price
   * @param fee Trading fee
   * @param currentPrices Optional map of current prices for all positions (for accurate totalValue calculation)
   *                      If not provided, uses stored totalValue for other positions
   */
  applyBuy(
    portfolio: Portfolio,
    coinId: string,
    quantity: number,
    price: number,
    fee: number,
    currentPrices?: Map<string, number>
  ): ApplyTradeResult {
    const totalCost = quantity * price + fee;

    // Validate sufficient funds
    if (portfolio.cashBalance < totalCost) {
      return {
        portfolio,
        success: false,
        error: 'Insufficient cash balance for buy trade'
      };
    }

    // Deduct cost from cash
    const newCashBalance = portfolio.cashBalance - quantity * price - fee;

    // Get or create position
    const existingPosition = portfolio.positions.get(coinId);
    let newPosition: Position;

    if (existingPosition && existingPosition.quantity > 0) {
      // Increase existing position - calculate new average price
      const newQuantity = existingPosition.quantity + quantity;
      const newAveragePrice =
        (existingPosition.averagePrice * existingPosition.quantity + price * quantity) / newQuantity;

      newPosition = {
        coinId,
        quantity: newQuantity,
        averagePrice: newAveragePrice,
        totalValue: newQuantity * price
      };
    } else {
      // New position
      newPosition = {
        coinId,
        quantity,
        averagePrice: price,
        totalValue: quantity * price
      };
    }

    // Create new positions map
    const newPositions = new Map(portfolio.positions);
    newPositions.set(coinId, newPosition);

    // Calculate new total value using provided prices or fallback to stored values
    const pricesForCalculation = currentPrices ?? new Map([[coinId, price]]);
    const newTotalValue = newCashBalance + this.calculatePositionsValue(newPositions, pricesForCalculation);

    return {
      portfolio: {
        cashBalance: newCashBalance,
        positions: newPositions,
        totalValue: newTotalValue
      },
      success: true
    };
  }

  /**
   * Apply a sell trade to the portfolio
   * Adds proceeds to cash (after fee deduction), reduces or closes position
   *
   * @param portfolio Current portfolio state
   * @param coinId The coin to sell
   * @param quantity Amount to sell
   * @param price Execution price
   * @param fee Trading fee
   * @param currentPrices Optional map of current prices for all positions (for accurate totalValue calculation)
   *                      If not provided, uses stored totalValue for other positions
   */
  applySell(
    portfolio: Portfolio,
    coinId: string,
    quantity: number,
    price: number,
    fee: number,
    currentPrices?: Map<string, number>
  ): ApplyTradeResult {
    const existingPosition = portfolio.positions.get(coinId);

    // Validate position exists
    if (!existingPosition || existingPosition.quantity === 0) {
      return {
        portfolio,
        success: false,
        error: 'No position to sell'
      };
    }

    // Cap quantity to available
    const actualQuantity = Math.min(quantity, existingPosition.quantity);
    const proceeds = actualQuantity * price;

    // Add proceeds and deduct fee from cash
    const newCashBalance = portfolio.cashBalance + proceeds - fee;

    // Update position
    const remainingQuantity = existingPosition.quantity - actualQuantity;
    const newPositions = new Map(portfolio.positions);

    if (remainingQuantity <= 0) {
      // Close position completely
      newPositions.delete(coinId);
    } else {
      // Reduce position
      newPositions.set(coinId, {
        coinId,
        quantity: remainingQuantity,
        averagePrice: existingPosition.averagePrice, // Average price unchanged on sell
        totalValue: remainingQuantity * price
      });
    }

    // Calculate new total value using provided prices or fallback to stored values
    const pricesForCalculation = currentPrices ?? new Map([[coinId, price]]);
    const newTotalValue = newCashBalance + this.calculatePositionsValue(newPositions, pricesForCalculation);

    return {
      portfolio: {
        cashBalance: newCashBalance,
        positions: newPositions,
        totalValue: newTotalValue
      },
      success: true
    };
  }

  /**
   * Create a snapshot of the current portfolio state
   */
  createSnapshot(
    portfolio: Portfolio,
    timestamp: Date,
    prices: Map<string, number>,
    initialCapital: number,
    drawdownState: DrawdownState
  ): PortfolioSnapshot {
    const holdings: Record<string, { quantity: number; value: number; price: number }> = {};

    for (const [coinId, position] of portfolio.positions) {
      const price = prices.get(coinId) ?? 0;
      holdings[coinId] = {
        quantity: position.quantity,
        value: position.quantity * price,
        price
      };
    }

    return {
      timestamp,
      portfolioValue: portfolio.totalValue,
      cashBalance: portfolio.cashBalance,
      holdings,
      cumulativeReturn: initialCapital > 0 ? (portfolio.totalValue - initialCapital) / initialCapital : 0,
      drawdown: drawdownState.currentDrawdown
    };
  }

  /**
   * Update drawdown tracking with current portfolio value
   */
  updateDrawdown(currentValue: number, currentState: DrawdownState): DrawdownState {
    let { peakValue, maxDrawdown } = currentState;

    // Update peak if new high
    if (currentValue > peakValue) {
      peakValue = currentValue;
    }

    // Calculate current drawdown
    const currentDrawdown = peakValue === 0 ? 0 : (peakValue - currentValue) / peakValue;

    // Update max drawdown if this is larger
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }

    return {
      peakValue,
      maxDrawdown,
      currentDrawdown
    };
  }

  /**
   * Calculate total positions value
   */
  calculatePositionsValue(positions: Map<string, Position>, prices: Map<string, number>): number {
    let total = 0;

    for (const [coinId, position] of positions) {
      const price = prices.get(coinId);
      if (price !== undefined) {
        total += position.quantity * price;
      } else {
        // Use stored totalValue if no current price
        total += position.totalValue;
      }
    }

    return total;
  }

  /**
   * Serialize portfolio for checkpointing
   */
  serialize(portfolio: Portfolio): SerializablePortfolio {
    return {
      cashBalance: portfolio.cashBalance,
      positions: Array.from(portfolio.positions.entries()).map(([coinId, pos]) => ({
        coinId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice
      }))
    };
  }

  /**
   * Deserialize portfolio from checkpoint
   */
  deserialize(serialized: SerializablePortfolio, currentPrices?: Map<string, number>): Portfolio {
    const positions = new Map<string, Position>();
    let positionsValue = 0;

    for (const pos of serialized.positions) {
      const price = currentPrices?.get(pos.coinId) ?? pos.averagePrice;
      const totalValue = pos.quantity * price;

      positions.set(pos.coinId, {
        coinId: pos.coinId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        totalValue
      });

      positionsValue += totalValue;
    }

    return {
      cashBalance: serialized.cashBalance,
      positions,
      totalValue: serialized.cashBalance + positionsValue
    };
  }
}
