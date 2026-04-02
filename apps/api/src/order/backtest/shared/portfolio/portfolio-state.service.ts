import { Injectable } from '@nestjs/common';

import { Decimal } from 'decimal.js';

import { MAINTENANCE_MARGIN_RATE } from '@chansey/api-interfaces';

import { deserializePortfolio, getPositionValue, serializePortfolio } from './portfolio-serialization.util';
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
 * All financial arithmetic uses Decimal.js for precision.
 * `.toNumber()` is called only at interface boundaries.
 */
@Injectable()
export class PortfolioStateService implements IPortfolioState {
  /**
   * Build a failure trade result — returns the portfolio unchanged with an error message.
   */
  private failResult(portfolio: Portfolio, error: string): ApplyTradeResult {
    return { portfolio, success: false, error };
  }

  /**
   * Build a successful trade result with recalculated totalValue.
   */
  private buildSuccessResult(
    cashBalance: number,
    positions: Map<string, Position>,
    coinId: string,
    price: number,
    currentPrices?: Map<string, number>,
    marginFields?: { totalMarginUsed: number; availableMargin: number }
  ): ApplyTradeResult {
    const pricesForCalculation = currentPrices ?? new Map([[coinId, price]]);
    const totalValue = new Decimal(cashBalance)
      .plus(this.calculatePositionsValue(positions, pricesForCalculation))
      .toNumber();
    return {
      portfolio: {
        cashBalance,
        positions,
        totalValue,
        ...marginFields
      },
      success: true
    };
  }

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
    let totalValue = new Decimal(portfolio.cashBalance);
    const newPositions = new Map<string, Position>();

    for (const [coinId, position] of portfolio.positions) {
      const newTotalValue = getPositionValue(position, prices.get(coinId));

      // Create new position object (immutable)
      newPositions.set(coinId, {
        ...position,
        totalValue: newTotalValue
      });

      totalValue = totalValue.plus(newTotalValue);
    }

    return {
      cashBalance: portfolio.cashBalance,
      positions: newPositions,
      totalValue: totalValue.toNumber(),
      totalMarginUsed: portfolio.totalMarginUsed,
      availableMargin: portfolio.availableMargin
    };
  }

  /**
   * Apply a buy trade to the portfolio
   * Deducts cost + fee from cash, adds or increases position
   */
  applyBuy(
    portfolio: Portfolio,
    coinId: string,
    quantity: number,
    price: number,
    fee: number,
    currentPrices?: Map<string, number>
  ): ApplyTradeResult {
    const dQuantity = new Decimal(quantity);
    const dPrice = new Decimal(price);
    const dFee = new Decimal(fee);
    const totalCost = dQuantity.mul(dPrice).plus(dFee).toNumber();

    // Validate sufficient funds
    if (portfolio.cashBalance < totalCost) {
      return this.failResult(portfolio, 'Insufficient cash balance for buy trade');
    }

    // Deduct cost from cash
    const newCashBalance = new Decimal(portfolio.cashBalance).minus(dQuantity.mul(dPrice)).minus(dFee).toNumber();

    // Get or create position
    const existingPosition = portfolio.positions.get(coinId);

    // Guard: reject if a short position exists for this coin
    if (existingPosition && existingPosition.side === 'short' && existingPosition.quantity > 0) {
      return this.failResult(portfolio, 'Cannot buy: short position already exists for this coin');
    }

    let newPosition: Position;

    if (existingPosition && existingPosition.quantity > 0) {
      // Increase existing position - calculate new average price
      const dExistingQty = new Decimal(existingPosition.quantity);
      const dExistingAvg = new Decimal(existingPosition.averagePrice);
      const newQuantity = dExistingQty.plus(dQuantity);
      const newAveragePrice = dExistingAvg.mul(dExistingQty).plus(dPrice.mul(dQuantity)).div(newQuantity);

      newPosition = {
        coinId,
        quantity: newQuantity.toNumber(),
        averagePrice: newAveragePrice.toNumber(),
        totalValue: newQuantity.mul(dPrice).toNumber()
      };
    } else {
      // New position
      newPosition = {
        coinId,
        quantity,
        averagePrice: price,
        totalValue: dQuantity.mul(dPrice).toNumber()
      };
    }

    // Create new positions map
    const newPositions = new Map(portfolio.positions);
    newPositions.set(coinId, newPosition);

    return this.buildSuccessResult(newCashBalance, newPositions, coinId, price, currentPrices);
  }

  /**
   * Apply a sell trade to the portfolio
   * Adds proceeds to cash (after fee deduction), reduces or closes position
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
      return this.failResult(portfolio, 'No position to sell');
    }

    // Cap quantity to available
    const actualQuantity = Math.min(quantity, existingPosition.quantity);
    const dActualQty = new Decimal(actualQuantity);
    const dPrice = new Decimal(price);
    const dFee = new Decimal(fee);
    const proceeds = dActualQty.mul(dPrice);

    // Add proceeds and deduct fee from cash
    const newCashBalance = new Decimal(portfolio.cashBalance).plus(proceeds).minus(dFee).toNumber();

    // Update position
    const remainingQuantity = new Decimal(existingPosition.quantity).minus(dActualQty).toNumber();
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
        totalValue: new Decimal(remainingQuantity).mul(dPrice).toNumber()
      });
    }

    return this.buildSuccessResult(newCashBalance, newPositions, coinId, price, currentPrices);
  }

  /**
   * Apply an open short trade to the portfolio.
   * Locks margin from cashBalance and creates a short position.
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
      return this.failResult(portfolio, 'Cannot open short: long position already exists for this coin');
    }

    const dQuantity = new Decimal(quantity);
    const dPrice = new Decimal(price);
    const dFee = new Decimal(fee);
    const dLeverage = new Decimal(leverage);
    const marginAmount = dQuantity.mul(dPrice).div(dLeverage);

    // Validate sufficient funds for margin + fee
    if (portfolio.cashBalance < marginAmount.plus(dFee).toNumber()) {
      return this.failResult(portfolio, 'Insufficient cash balance for short trade margin');
    }

    // Deduct margin + fee from cash
    const newCashBalance = new Decimal(portfolio.cashBalance).minus(marginAmount).minus(dFee).toNumber();

    // Calculate liquidation price: price * (1 + 1/leverage - maintenanceMarginRate)
    const liquidationPrice = dPrice
      .mul(new Decimal(1).plus(new Decimal(1).div(dLeverage)).minus(MAINTENANCE_MARGIN_RATE))
      .toNumber();

    // Create short position
    const newPosition: Position = {
      coinId,
      quantity,
      averagePrice: price,
      totalValue: marginAmount.toNumber(),
      side: 'short',
      leverage,
      marginAmount: marginAmount.toNumber(),
      liquidationPrice
    };

    // Create new positions map
    const newPositions = new Map(portfolio.positions);
    newPositions.set(coinId, newPosition);

    const newTotalMarginUsed = new Decimal(portfolio.totalMarginUsed ?? 0).plus(marginAmount).toNumber();

    return this.buildSuccessResult(newCashBalance, newPositions, coinId, price, currentPrices, {
      totalMarginUsed: newTotalMarginUsed,
      availableMargin: newCashBalance
    });
  }

  /**
   * Apply a close short trade to the portfolio.
   * Returns margin proportionally and realizes P&L.
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
      return this.failResult(portfolio, 'No short position to close');
    }

    // Cap quantity to available
    const actualQuantity = Math.min(quantity, existingPosition.quantity);
    const dActualQty = new Decimal(actualQuantity);
    const dPrice = new Decimal(price);
    const dFee = new Decimal(fee);
    const dExistingQty = new Decimal(existingPosition.quantity);
    const dMarginAmount = new Decimal(existingPosition.marginAmount ?? 0);
    const dAvgPrice = new Decimal(existingPosition.averagePrice);

    // Calculate realized P&L: (entryPrice - exitPrice) * quantity (profit when price drops)
    const realizedPnL = dAvgPrice.minus(dPrice).mul(dActualQty);

    // Return margin proportionally
    const returnedMargin = dMarginAmount.mul(dActualQty).div(dExistingQty);

    // Cap loss at margin amount
    const cappedPnL = Decimal.max(returnedMargin.neg(), realizedPnL);

    // Update cashBalance: += returnedMargin + cappedPnL - fee
    const newCashBalance = new Decimal(portfolio.cashBalance)
      .plus(returnedMargin)
      .plus(cappedPnL)
      .minus(dFee)
      .toNumber();

    // Update position
    const remainingQuantity = dExistingQty.minus(dActualQty).toNumber();
    const newPositions = new Map(portfolio.positions);

    if (remainingQuantity <= 0) {
      newPositions.delete(coinId);
    } else {
      const remainingMargin = dMarginAmount.minus(returnedMargin);
      const remainingValue = remainingMargin.plus(dAvgPrice.minus(dPrice).mul(remainingQuantity));
      newPositions.set(coinId, {
        ...existingPosition,
        quantity: remainingQuantity,
        totalValue: remainingValue.toNumber(),
        marginAmount: remainingMargin.toNumber()
      });
    }

    const newTotalMarginUsed = Decimal.max(
      0,
      new Decimal(portfolio.totalMarginUsed ?? 0).minus(returnedMargin)
    ).toNumber();

    return this.buildSuccessResult(newCashBalance, newPositions, coinId, price, currentPrices, {
      totalMarginUsed: newTotalMarginUsed,
      availableMargin: newCashBalance
    });
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
        value: new Decimal(position.quantity).mul(price).toNumber(),
        price
      };
    }

    const cumulativeReturn =
      initialCapital > 0 ? new Decimal(portfolio.totalValue).minus(initialCapital).div(initialCapital).toNumber() : 0;

    return {
      timestamp,
      portfolioValue: portfolio.totalValue,
      cashBalance: portfolio.cashBalance,
      holdings,
      cumulativeReturn,
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
    let total = new Decimal(0);
    for (const [coinId, position] of positions) {
      total = total.plus(getPositionValue(position, prices.get(coinId)));
    }
    return total.toNumber();
  }

  /**
   * Serialize portfolio for checkpointing
   */
  serialize(portfolio: Portfolio): SerializablePortfolio {
    return serializePortfolio(portfolio);
  }

  /**
   * Deserialize portfolio from checkpoint
   */
  deserialize(serialized: SerializablePortfolio, currentPrices?: Map<string, number>): Portfolio {
    return deserializePortfolio(serialized, currentPrices);
  }
}
