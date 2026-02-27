import { Injectable } from '@nestjs/common';

import { MAINTENANCE_MARGIN_RATE } from '@chansey/api-interfaces';

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
      totalValue: initialCapital,
      totalMarginUsed: 0,
      availableMargin: initialCapital
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
      let newTotalValue: number;

      if (position.side === 'short' && position.marginAmount !== undefined) {
        // Short position value = margin + unrealized P&L
        // Unrealized P&L for short = (entryPrice - currentPrice) * quantity
        newTotalValue =
          currentPrice !== undefined
            ? Math.max(0, position.marginAmount + (position.averagePrice - currentPrice) * position.quantity)
            : position.totalValue;
      } else {
        newTotalValue = currentPrice !== undefined ? position.quantity * currentPrice : position.totalValue;
      }

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
      totalValue,
      totalMarginUsed: portfolio.totalMarginUsed,
      availableMargin: portfolio.availableMargin
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

    // Guard: reject if a short position exists for this coin
    if (existingPosition && existingPosition.side === 'short' && existingPosition.quantity > 0) {
      return {
        portfolio,
        success: false,
        error: 'Cannot buy: short position already exists for this coin'
      };
    }

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
   * Apply an open short trade to the portfolio.
   * Locks margin from cashBalance and creates a short position.
   *
   * @param portfolio Current portfolio state
   * @param coinId The coin to short
   * @param quantity Amount to short
   * @param price Execution price
   * @param fee Trading fee
   * @param leverage Leverage multiplier (default: 1)
   * @param currentPrices Optional map of current prices for all positions
   */
  applyOpenShort(
    portfolio: Portfolio,
    coinId: string,
    quantity: number,
    price: number,
    fee: number,
    leverage = 1,
    currentPrices?: Map<string, number>
  ): ApplyTradeResult {
    // Guard: reject if a long position exists for this coin
    const existingLong = portfolio.positions.get(coinId);
    if (existingLong && existingLong.side !== 'short' && existingLong.quantity > 0) {
      return {
        portfolio,
        success: false,
        error: 'Cannot open short: long position already exists for this coin'
      };
    }

    const marginAmount = (quantity * price) / leverage;

    // Validate sufficient funds for margin + fee
    if (portfolio.cashBalance < marginAmount + fee) {
      return {
        portfolio,
        success: false,
        error: 'Insufficient cash balance for short trade margin'
      };
    }

    // Deduct margin + fee from cash
    const newCashBalance = portfolio.cashBalance - marginAmount - fee;

    // Calculate liquidation price: price * (1 + 1/leverage - maintenanceMarginRate)
    const maintenanceMarginRate = MAINTENANCE_MARGIN_RATE;
    const liquidationPrice = price * (1 + 1 / leverage - maintenanceMarginRate);

    // Create short position
    const newPosition: Position = {
      coinId,
      quantity,
      averagePrice: price,
      totalValue: marginAmount,
      side: 'short',
      leverage,
      marginAmount,
      liquidationPrice
    };

    // Create new positions map
    const newPositions = new Map(portfolio.positions);
    newPositions.set(coinId, newPosition);

    // Calculate new total value
    const pricesForCalculation = currentPrices ?? new Map([[coinId, price]]);
    const newTotalValue = newCashBalance + this.calculatePositionsValue(newPositions, pricesForCalculation);

    const newTotalMarginUsed = (portfolio.totalMarginUsed ?? 0) + marginAmount;

    return {
      portfolio: {
        cashBalance: newCashBalance,
        positions: newPositions,
        totalValue: newTotalValue,
        totalMarginUsed: newTotalMarginUsed,
        availableMargin: newCashBalance
      },
      success: true
    };
  }

  /**
   * Apply a close short trade to the portfolio.
   * Returns margin proportionally and realizes P&L.
   *
   * @param portfolio Current portfolio state
   * @param coinId The coin to close short on
   * @param quantity Amount to close
   * @param price Execution price (exit price)
   * @param fee Trading fee
   * @param currentPrices Optional map of current prices for all positions
   */
  applyCloseShort(
    portfolio: Portfolio,
    coinId: string,
    quantity: number,
    price: number,
    fee: number,
    currentPrices?: Map<string, number>
  ): ApplyTradeResult {
    const existingPosition = portfolio.positions.get(coinId);

    // Validate short position exists
    if (!existingPosition || existingPosition.side !== 'short' || existingPosition.quantity === 0) {
      return {
        portfolio,
        success: false,
        error: 'No short position to close'
      };
    }

    // Cap quantity to available
    const actualQuantity = Math.min(quantity, existingPosition.quantity);

    // Calculate realized P&L: (entryPrice - exitPrice) * quantity (profit when price drops)
    const realizedPnL = (existingPosition.averagePrice - price) * actualQuantity;

    // Return margin proportionally
    const returnedMargin = (existingPosition.marginAmount ?? 0) * (actualQuantity / existingPosition.quantity);

    // Cap loss at margin amount
    const cappedPnL = Math.max(-returnedMargin, realizedPnL);

    // Update cashBalance: += returnedMargin + cappedPnL - fee
    const newCashBalance = portfolio.cashBalance + returnedMargin + cappedPnL - fee;

    // Update position
    const remainingQuantity = existingPosition.quantity - actualQuantity;
    const newPositions = new Map(portfolio.positions);

    if (remainingQuantity <= 0) {
      newPositions.delete(coinId);
    } else {
      const remainingMargin = (existingPosition.marginAmount ?? 0) - returnedMargin;
      newPositions.set(coinId, {
        ...existingPosition,
        quantity: remainingQuantity,
        totalValue: remainingMargin + (existingPosition.averagePrice - price) * remainingQuantity,
        marginAmount: remainingMargin
      });
    }

    // Calculate new total value
    const pricesForCalculation = currentPrices ?? new Map([[coinId, price]]);
    const newTotalValue = newCashBalance + this.calculatePositionsValue(newPositions, pricesForCalculation);

    const newTotalMarginUsed = Math.max(0, (portfolio.totalMarginUsed ?? 0) - returnedMargin);

    return {
      portfolio: {
        cashBalance: newCashBalance,
        positions: newPositions,
        totalValue: newTotalValue,
        totalMarginUsed: newTotalMarginUsed,
        availableMargin: newCashBalance
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
      if (position.side === 'short' && position.marginAmount !== undefined) {
        // Short position value = margin + unrealized P&L
        if (price !== undefined) {
          total += Math.max(0, position.marginAmount + (position.averagePrice - price) * position.quantity);
        } else {
          total += position.totalValue;
        }
      } else {
        if (price !== undefined) {
          total += position.quantity * price;
        } else {
          // Use stored totalValue if no current price
          total += position.totalValue;
        }
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
        averagePrice: pos.averagePrice,
        ...(pos.entryDate && { entryDate: pos.entryDate.toISOString() }),
        ...(pos.side && { side: pos.side }),
        ...(pos.leverage !== undefined && { leverage: pos.leverage }),
        ...(pos.marginAmount !== undefined && { marginAmount: pos.marginAmount }),
        ...(pos.liquidationPrice !== undefined && { liquidationPrice: pos.liquidationPrice })
      }))
    };
  }

  /**
   * Deserialize portfolio from checkpoint
   */
  deserialize(serialized: SerializablePortfolio, currentPrices?: Map<string, number>): Portfolio {
    const positions = new Map<string, Position>();
    let positionsValue = 0;
    let totalMarginUsed = 0;

    for (const pos of serialized.positions) {
      const price = currentPrices?.get(pos.coinId) ?? pos.averagePrice;
      let totalValue: number;

      if (pos.side === 'short' && pos.marginAmount !== undefined) {
        // Short position value = margin + unrealized P&L
        totalValue = pos.marginAmount + (pos.averagePrice - price) * pos.quantity;
        totalMarginUsed += pos.marginAmount;
      } else {
        totalValue = pos.quantity * price;
      }

      positions.set(pos.coinId, {
        coinId: pos.coinId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        totalValue,
        ...(pos.entryDate && { entryDate: new Date(pos.entryDate) }),
        ...(pos.side && { side: pos.side }),
        ...(pos.leverage !== undefined && { leverage: pos.leverage }),
        ...(pos.marginAmount !== undefined && { marginAmount: pos.marginAmount }),
        ...(pos.liquidationPrice !== undefined && { liquidationPrice: pos.liquidationPrice })
      });

      positionsValue += totalValue;
    }

    return {
      cashBalance: serialized.cashBalance,
      positions,
      totalValue: serialized.cashBalance + positionsValue,
      totalMarginUsed,
      availableMargin: serialized.cashBalance
    };
  }
}
